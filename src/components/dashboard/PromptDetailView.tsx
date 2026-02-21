import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  formatCost,
  formatTokens,
  getContextLimit,
  getGaugeColor,
  getModelShort,
  CATEGORY_COLORS,
  ACTION_COLORS,
} from "../scan/shared";
import { ContextTreemap } from "./ContextTreemap";
import { ActionFlowList } from "./ActionFlowList";
import type { PromptScan, UsageLogEntry } from "../../types";

const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter/dist/esm/prism-async-light").then((mod) => ({
    default: mod.default,
  })),
);
const syntaxThemePromise =
  import("react-syntax-highlighter/dist/esm/styles/prism/one-dark").then(
    (mod) => mod.default,
  );

const getLanguage = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    sh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    rb: "ruby",
    swift: "swift",
  };
  return map[ext] || "text";
};

const CONTINUATION_PROMPT_MARKER =
  "This session is being continued from a previous conversation that ran out of context";
const SESSION_SCAN_DEDUP_MS = 5_000;
const COMPACTION_DROP_RATIO = 0.8;
const MIN_COMPACTION_BASE_TOKENS = 30_000;
const DIRECT_FILE_ACTIONS = new Set(["Read", "Write", "Edit"]);

type EvidenceStatus = "confirmed" | "likely" | "unverified";

type InjectedEvidenceItem = {
  path: string;
  category: "global" | "project" | "rules" | "memory" | "skill";
  estimated_tokens: number;
  status: EvidenceStatus;
  reason: string;
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const getFileName = (pathValue: string): string =>
  pathValue.split("/").filter(Boolean).pop() ?? pathValue;

const buildInjectedEvidence = (scan: PromptScan): Record<
  EvidenceStatus,
  InjectedEvidenceItem[]
> => {
  const injectedFiles = scan.injected_files ?? [];
  const toolCalls = scan.tool_calls ?? [];
  const userPromptLower = normalizeText(scan.user_prompt ?? "");
  const responseLower = normalizeText(scan.assistant_response ?? "");

  const classified: InjectedEvidenceItem[] = injectedFiles.map((file) => {
    const filePathLower = normalizeText(file.path);
    const fileName = getFileName(file.path);
    const fileNameLower = normalizeText(fileName);

    const directAction = toolCalls.find((toolCall) => {
      if (!DIRECT_FILE_ACTIONS.has(toolCall.name)) return false;
      const inputLower = normalizeText(toolCall.input_summary ?? "");
      return (
        inputLower.includes(filePathLower) ||
        (fileNameLower.length >= 4 && inputLower.includes(fileNameLower))
      );
    });

    if (directAction) {
      return {
        ...file,
        status: "confirmed",
        reason: `${directAction.name} referenced this file directly`,
      };
    }

    const mentionByTool = toolCalls.find((toolCall) => {
      const inputLower = normalizeText(toolCall.input_summary ?? "");
      return fileNameLower.length >= 4 && inputLower.includes(fileNameLower);
    });
    const mentionByResponse =
      fileNameLower.length >= 4 && responseLower.includes(fileNameLower);
    const mentionByPrompt =
      fileNameLower.length >= 4 && userPromptLower.includes(fileNameLower);

    if (mentionByResponse || mentionByTool || mentionByPrompt) {
      const reason = mentionByResponse
        ? "Assistant response mentions this file"
        : mentionByTool
          ? `${mentionByTool.name} input references this file`
          : "User prompt references this file";
      return {
        ...file,
        status: "likely",
        reason,
      };
    }

    return {
      ...file,
      status: "unverified",
      reason: "No direct reference found in actions or response",
    };
  });

  const byStatus: Record<EvidenceStatus, InjectedEvidenceItem[]> = {
    confirmed: [],
    likely: [],
    unverified: [],
  };

  for (const item of classified.sort(
    (a, b) => b.estimated_tokens - a.estimated_tokens,
  )) {
    byStatus[item.status].push(item);
  }

  return byStatus;
};

type PromptDetailViewProps = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  onBack: () => void;
};

export const PromptDetailView = ({
  scan,
  usage,
  onBack,
}: PromptDetailViewProps) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["context", "injected-evidence"]),
  );
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [expandedActions, setExpandedActions] = useState<Set<number>>(
    () => new Set(),
  );
  const [sessionCompactions, setSessionCompactions] = useState<number | null>(
    null,
  );
  const toggleAction = (idx: number) =>
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  const toggle = (section: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const ctx = scan.context_estimate ?? {
    system_tokens: 0,
    messages_tokens: 0,
    tools_definition_tokens: 0,
    total_tokens: 0,
  };
  const limit = getContextLimit(scan.model ?? "");
  const ctxPct =
    ctx.total_tokens > 0 ? Math.min((ctx.total_tokens / limit) * 100, 100) : 0;
  const gaugeColor = getGaugeColor(ctxPct);

  const bd = ctx.messages_tokens_breakdown;
  const hasBreakdown =
    bd &&
    (bd.user_text_tokens > 0 ||
      bd.assistant_tokens > 0 ||
      bd.tool_result_tokens > 0);
  const userTextTokens = bd?.user_text_tokens ?? 0;
  const assistantTokens = bd?.assistant_tokens ?? 0;
  const toolResultTokens = bd?.tool_result_tokens ?? 0;
  const conversationTokens = ctx.messages_tokens - toolResultTokens;

  const systemPct =
    ctx.total_tokens > 0 ? (ctx.system_tokens / ctx.total_tokens) * 100 : 0;
  const userTextPct =
    ctx.total_tokens > 0 ? (userTextTokens / ctx.total_tokens) * 100 : 0;
  const assistantPct =
    ctx.total_tokens > 0 ? (assistantTokens / ctx.total_tokens) * 100 : 0;
  const conversationPct =
    ctx.total_tokens > 0 ? (conversationTokens / ctx.total_tokens) * 100 : 0;
  const toolResultPct =
    ctx.total_tokens > 0 ? (toolResultTokens / ctx.total_tokens) * 100 : 0;
  const toolsDefPct =
    ctx.total_tokens > 0
      ? (ctx.tools_definition_tokens / ctx.total_tokens) * 100
      : 0;

  const injectedFiles = scan.injected_files ?? [];
  const toolCalls = scan.tool_calls ?? [];
  const hasAssistantResponse = Boolean(scan.assistant_response?.trim());
  const hasOutputTokens = (usage?.response.output_tokens ?? 0) > 0;
  const isPromptCompleted = hasAssistantResponse || hasOutputTokens;
  const actionCounts = Object.entries(scan.tool_summary ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const topInjectedFiles = [...injectedFiles]
    .sort((a, b) => b.estimated_tokens - a.estimated_tokens)
    .slice(0, 3);
  const injectedEvidence = buildInjectedEvidence(scan);
  const cacheBaseTokens = usage
    ? usage.response.input_tokens +
      usage.response.cache_read_input_tokens +
      usage.response.cache_creation_input_tokens
    : 0;
  const cacheHitPct =
    usage && cacheBaseTokens > 0
      ? (usage.response.cache_read_input_tokens / cacheBaseTokens) * 100
      : null;

  useEffect(() => {
    let isActive = true;

    const loadCompactionCount = async () => {
      try {
        if (!scan.session_id) {
          if (isActive) setSessionCompactions(0);
          return;
        }

        const targetTimestampMs = new Date(scan.timestamp).getTime();
        if (!Number.isFinite(targetTimestampMs)) {
          if (isActive) setSessionCompactions(0);
          return;
        }

        const sessionScans = await window.api.getSessionScans(scan.session_id);
        const sorted = [...sessionScans].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        const dedupedUntilTarget: PromptScan[] = [];
        for (const item of sorted) {
          const itemTimestampMs = new Date(item.timestamp).getTime();
          if (!Number.isFinite(itemTimestampMs)) continue;
          if (itemTimestampMs > targetTimestampMs) continue;

          const prev = dedupedUntilTarget[dedupedUntilTarget.length - 1];
          if (prev) {
            const prevTimestampMs = new Date(prev.timestamp).getTime();
            const samePrompt =
              (prev.user_prompt || "").trim() === (item.user_prompt || "").trim();
            if (
              samePrompt &&
              Math.abs(itemTimestampMs - prevTimestampMs) < SESSION_SCAN_DEDUP_MS
            ) {
              continue;
            }
          }

          dedupedUntilTarget.push(item);
        }

        let count = 0;
        for (let i = 0; i < dedupedUntilTarget.length; i++) {
          const current = dedupedUntilTarget[i];
          const previous = dedupedUntilTarget[i - 1];
          const hasContinuationMarker = (current.user_prompt || "").includes(
            CONTINUATION_PROMPT_MARKER,
          );
          const previousTokens = previous?.context_estimate?.total_tokens ?? 0;
          const currentTokens = current.context_estimate?.total_tokens ?? 0;
          const hasSignificantDrop =
            previousTokens >= MIN_COMPACTION_BASE_TOKENS &&
            currentTokens > 0 &&
            currentTokens < previousTokens * COMPACTION_DROP_RATIO;

          if (hasContinuationMarker || hasSignificantDrop) {
            count += 1;
          }
        }

        if (isActive) setSessionCompactions(count);
      } catch {
        if (isActive) setSessionCompactions(0);
      }
    };

    loadCompactionCount();

    return () => {
      isActive = false;
    };
  }, [scan.request_id, scan.session_id, scan.timestamp]);

  return (
    <div>
      {/* Header */}
      <div className="prompt-detail-header">
        <button className="session-back-btn" onClick={onBack}>
          ‹ Back
        </button>
        <span className="prompt-detail-model" style={{ color: gaugeColor }}>
          {getModelShort(scan.model)}
        </span>
      </div>

      {/* Prompt Text */}
      <div
        className={`prompt-detail-text${promptExpanded ? " expanded" : ""}`}
        onClick={() =>
          scan.user_prompt &&
          scan.user_prompt.length > 100 &&
          setPromptExpanded((v) => !v)
        }
        style={
          scan.user_prompt && scan.user_prompt.length > 100
            ? { cursor: "pointer" }
            : undefined
        }
      >
        {!scan.user_prompt
          ? "(system request)"
          : promptExpanded
            ? scan.user_prompt
            : scan.user_prompt.length > 100
              ? scan.user_prompt.slice(0, 100) + "..."
              : scan.user_prompt}
      </div>

      {/* Response Preview */}
      {scan.assistant_response && (
        <Section
          title="Response"
          id="response"
          expanded={expandedSections}
          onToggle={toggle}
        >
          <div className="response-section">{scan.assistant_response}</div>
        </Section>
      )}

      {/* Context Gauge - Circular */}
      <div className="prompt-detail-gauge">
        <div className="gauge-circle-container">
          <svg width={80} height={80} viewBox="0 0 80 80">
            <circle
              cx={40}
              cy={40}
              r={34}
              fill="none"
              stroke="var(--gauge-track, rgba(0,0,0,0.06))"
              strokeWidth={6}
            />
            <circle
              cx={40}
              cy={40}
              r={34}
              fill="none"
              stroke={gaugeColor}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 34}
              strokeDashoffset={2 * Math.PI * 34 * (1 - ctxPct / 100)}
              transform="rotate(-90 40 40)"
            />
          </svg>
          <div className="gauge-circle-label">
            <span className="gauge-circle-pct">{Math.round(ctxPct)}%</span>
            <span className="gauge-circle-sub">context</span>
          </div>
        </div>
        <div className="gauge-circle-info">
          <div className="gauge-circle-row">
            <span>Total</span>
            <span>
              {formatTokens(ctx.total_tokens)} / {formatTokens(limit)}
            </span>
          </div>
          <div className="gauge-circle-row">
            <span>Model</span>
            <span>{getModelShort(scan.model)}</span>
          </div>
          {usage && (
            <div className="gauge-circle-row">
              <span>Cost</span>
              <span>{formatCost(usage.cost_usd)}</span>
            </div>
          )}
          {cacheHitPct !== null && (
            <div className="gauge-circle-row">
              <span>Cache hit</span>
              <span>{cacheHitPct.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Context Treemap */}
      <ContextTreemap
        scan={scan}
        onFileClick={(path) => setPreviewFile(path)}
      />

      {/* Quick Stats */}
      <div className="prompt-detail-stats">
        <StatPill label="Turns" value={String(scan.conversation_turns ?? 0)} />
        <StatPill label="Tools" value={String(toolCalls.length)} />
        <StatPill label="Files" value={String(injectedFiles.length)} />
        <StatPill
          label="Compactions"
          value={
            sessionCompactions === null ? "..." : String(sessionCompactions)
          }
        />
        {usage && (
          <StatPill
            label="Duration"
            value={`${(usage.duration_ms / 1000).toFixed(1)}s`}
          />
        )}
      </div>

      <div className="journey-summary">
        <div className="journey-summary-title">Prompt Journey</div>
        <div className="journey-summary-grid">
          <div className="journey-summary-card">
            <div className="journey-summary-label">Prompt</div>
            <div className="journey-summary-value">
              {formatTokens(scan.user_prompt_tokens || 0)} tokens
            </div>
          </div>
          <div className="journey-summary-card">
            <div className="journey-summary-label">Injected</div>
            <div className="journey-summary-value">
              {injectedFiles.length} files · {formatTokens(scan.total_injected_tokens || 0)}
            </div>
          </div>
          <div className="journey-summary-card">
            <div className="journey-summary-label">Actions</div>
            <div className="journey-summary-value">{toolCalls.length} calls</div>
            {actionCounts.length > 0 && (
              <div className="journey-summary-sub">
                {actionCounts.map(([name, cnt]) => `${name}×${cnt}`).join(" · ")}
              </div>
            )}
          </div>
          {usage && (
            <div className="journey-summary-card">
              <div className="journey-summary-label">Cache Hit</div>
              <div className="journey-summary-value">
                {cacheHitPct !== null ? `${cacheHitPct.toFixed(1)}%` : "-"}
              </div>
              <div className="journey-summary-sub">
                Read {formatTokens(usage.response.cache_read_input_tokens)} tokens
              </div>
            </div>
          )}
        </div>
        {topInjectedFiles.length > 0 && (
          <div className="journey-summary-files">
            {topInjectedFiles.map((file) => (
              <button
                key={file.path}
                className="journey-summary-file"
                onClick={() => setPreviewFile(file.path)}
              >
                <span className="journey-summary-file-name">
                  {file.path.split("/").slice(-2).join("/")}
                </span>
                <span className="journey-summary-file-tokens">
                  {formatTokens(file.estimated_tokens)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Section
        title={`Injected Evidence (C ${injectedEvidence.confirmed.length} · L ${injectedEvidence.likely.length} · U ${injectedEvidence.unverified.length})`}
        id="injected-evidence"
        expanded={expandedSections}
        onToggle={toggle}
      >
        <div className="injected-evidence-summary">
          <span className="injected-evidence-badge confirmed">
            Confirmed {injectedEvidence.confirmed.length}
          </span>
          <span className="injected-evidence-badge likely">
            Likely {injectedEvidence.likely.length}
          </span>
          <span className="injected-evidence-badge unverified">
            Unverified {injectedEvidence.unverified.length}
          </span>
        </div>
        <EvidenceGroup
          title="Confirmed"
          status="confirmed"
          items={injectedEvidence.confirmed}
          onOpenFile={setPreviewFile}
        />
        <EvidenceGroup
          title="Likely"
          status="likely"
          items={injectedEvidence.likely}
          onOpenFile={setPreviewFile}
        />
        <EvidenceGroup
          title="Unverified"
          status="unverified"
          items={injectedEvidence.unverified}
          onOpenFile={setPreviewFile}
        />
      </Section>

      {/* Context Breakdown Bar */}
      <Section
        title="Context Breakdown"
        id="context"
        expanded={expandedSections}
        onToggle={toggle}
      >
        <div className="ctx-breakdown-bar-wrap">
          <div className="ctx-breakdown-bar">
            <div
              className="ctx-segment"
              style={{ width: `${systemPct}%`, background: "#8b5cf6" }}
              onMouseEnter={() => setHoveredSegment("system")}
              onMouseLeave={() => setHoveredSegment(null)}
            />
            {hasBreakdown ? (
              <>
                {userTextPct > 0 && (
                  <div
                    className="ctx-segment"
                    style={{ width: `${userTextPct}%`, background: "#3b82f6" }}
                    onMouseEnter={() => setHoveredSegment("userText")}
                    onMouseLeave={() => setHoveredSegment(null)}
                  />
                )}
                {assistantPct > 0 && (
                  <div
                    className="ctx-segment"
                    style={{ width: `${assistantPct}%`, background: "#60a5fa" }}
                    onMouseEnter={() => setHoveredSegment("assistant")}
                    onMouseLeave={() => setHoveredSegment(null)}
                  />
                )}
              </>
            ) : (
              <div
                className="ctx-segment"
                style={{ width: `${conversationPct}%`, background: "#3b82f6" }}
                onMouseEnter={() => setHoveredSegment("messages")}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            )}
            {toolResultPct > 0 && (
              <div
                className="ctx-segment"
                style={{ width: `${toolResultPct}%`, background: "#06b6d4" }}
                onMouseEnter={() => setHoveredSegment("toolResult")}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            )}
            {toolsDefPct > 0 && (
              <div
                className="ctx-segment"
                style={{ width: `${toolsDefPct}%`, background: "#f59e0b" }}
                onMouseEnter={() => setHoveredSegment("toolsDef")}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            )}
          </div>
          {hoveredSegment && (
            <BreakdownPopover
              segment={hoveredSegment}
              scan={scan}
              ctx={ctx}
              injectedFiles={injectedFiles}
              toolCalls={toolCalls}
              userTextTokens={userTextTokens}
              assistantTokens={assistantTokens}
              conversationTokens={conversationTokens}
              toolResultTokens={toolResultTokens}
              onFileClick={(path) => setPreviewFile(path)}
              onMouseEnter={() => setHoveredSegment(hoveredSegment)}
              onMouseLeave={() => setHoveredSegment(null)}
            />
          )}
        </div>
        <div className="ctx-breakdown-legend">
          <LegendDot
            color="#8b5cf6"
            label="System"
            value={formatTokens(ctx.system_tokens)}
          />
          {hasBreakdown ? (
            <>
              <LegendDot
                color="#3b82f6"
                label="Your Prompts"
                value={formatTokens(userTextTokens)}
              />
              <LegendDot
                color="#60a5fa"
                label="Responses"
                value={formatTokens(assistantTokens)}
              />
            </>
          ) : (
            <LegendDot
              color="#3b82f6"
              label="Messages"
              value={formatTokens(conversationTokens)}
            />
          )}
          {toolResultTokens > 0 && (
            <LegendDot
              color="#06b6d4"
              label="Action Results"
              value={formatTokens(toolResultTokens)}
            />
          )}
          {ctx.tools_definition_tokens > 0 && (
            <LegendDot
              color="#f59e0b"
              label="Tools Def"
              value={formatTokens(ctx.tools_definition_tokens)}
            />
          )}
        </div>
      </Section>

      {/* Injected Files */}
      <Section
        title={`Injected Files (${injectedFiles.length})`}
        id="files"
        expanded={expandedSections}
        onToggle={toggle}
      >
        {injectedFiles.length > 0 ? (
          <div className="file-list">
            {injectedFiles.map((f, i) => (
              <button
                key={i}
                className="file-item"
                onClick={() => setPreviewFile(f.path)}
              >
                <span
                  className="file-dot"
                  style={{
                    background: CATEGORY_COLORS[f.category] || "#8e8e93",
                  }}
                />
                <span className="file-path">
                  {f.path.split("/").slice(-2).join("/")}
                </span>
                <span className="file-tokens">
                  {formatTokens(f.estimated_tokens)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="section-empty">No injected files</div>
        )}
      </Section>

      {/* Actions */}
      <Section
        title={`Actions (${toolCalls.length})`}
        id="tools"
        expanded={expandedSections}
        onToggle={toggle}
      >
        {toolCalls.length > 0 ? (
          <ActionFlowList
            toolCalls={toolCalls}
            expandedActions={expandedActions}
            onToggleAction={toggleAction}
            onOpenFile={setPreviewFile}
            scanTimestamp={scan.timestamp}
            isCompleted={isPromptCompleted}
          />
        ) : (
          <div className="section-empty">No actions</div>
        )}
      </Section>

      {/* Token Breakdown */}
      {usage && (
        <Section
          title="Token Breakdown"
          id="tokens"
          expanded={expandedSections}
          onToggle={toggle}
        >
          <div className="token-breakdown">
            <TokenRow label="Input" value={usage.response.input_tokens} />
            <TokenRow label="Output" value={usage.response.output_tokens} />
            <TokenRow
              label="Cache Read"
              value={usage.response.cache_read_input_tokens}
            />
            <TokenRow
              label="Cache Create"
              value={usage.response.cache_creation_input_tokens}
            />
          </div>
        </Section>
      )}

      {/* File Preview Popup */}
      <AnimatePresence>
        {previewFile && (
          <FilePreviewOverlay
            filePath={previewFile}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Sub Components (macOS style) ---

const StatPill = ({ label, value }: { label: string; value: string }) => (
  <div className="stat-pill">
    <span className="stat-pill-value">{value}</span>
    <span className="stat-pill-label">{label}</span>
  </div>
);

type SectionProps = {
  title: string;
  id: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  children: React.ReactNode;
};

const Section = ({ title, id, expanded, onToggle, children }: SectionProps) => {
  const isOpen = expanded.has(id);
  return (
    <div className="detail-section">
      <button className="detail-section-header" onClick={() => onToggle(id)}>
        <span>{title}</span>
        <span className={`detail-section-chevron ${isOpen ? "expanded" : ""}`}>
          ›
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div className="detail-section-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const LegendDot = ({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) => (
  <div className="legend-dot-item">
    <span className="legend-dot" style={{ background: color }} />
    <span className="legend-label">{label}</span>
    <span className="legend-value">{value}</span>
  </div>
);

const TokenRow = ({ label, value }: { label: string; value: number }) => (
  <div className="token-row">
    <span className="token-row-label">{label}</span>
    <span className="token-row-value">{value.toLocaleString()}</span>
  </div>
);

const EvidenceGroup = ({
  title,
  status,
  items,
  onOpenFile,
}: {
  title: string;
  status: EvidenceStatus;
  items: InjectedEvidenceItem[];
  onOpenFile: (path: string) => void;
}) => {
  if (items.length === 0) return null;
  return (
    <div className="injected-evidence-group">
      <div className="injected-evidence-group-title">
        <span className={`injected-evidence-dot ${status}`} />
        <span>{title}</span>
      </div>
      <div className="injected-evidence-list">
        {items.map((item) => (
          <button
            key={`${status}-${item.path}`}
            className="injected-evidence-item"
            onClick={() => onOpenFile(item.path)}
          >
            <span className="injected-evidence-item-main">
              <span className="injected-evidence-item-path">
                {item.path.split("/").slice(-2).join("/")}
              </span>
              <span className="injected-evidence-item-reason">{item.reason}</span>
            </span>
            <span className="injected-evidence-item-tokens">
              {formatTokens(item.estimated_tokens)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

// --- Breakdown Popover ---

type BreakdownPopoverProps = {
  segment: string;
  scan: PromptScan;
  ctx: {
    system_tokens: number;
    messages_tokens: number;
    tools_definition_tokens: number;
    total_tokens: number;
    messages_tokens_breakdown?: {
      user_text_tokens: number;
      assistant_tokens: number;
      tool_result_tokens: number;
    };
  };
  injectedFiles: Array<{
    path: string;
    estimated_tokens: number;
    category: string;
  }>;
  toolCalls: Array<{
    index: number;
    name: string;
    input_summary: string;
    timestamp?: string;
  }>;
  userTextTokens: number;
  assistantTokens: number;
  conversationTokens: number;
  toolResultTokens: number;
  onFileClick: (path: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

const BreakdownPopover = ({
  segment,
  scan,
  ctx,
  injectedFiles,
  toolCalls,
  userTextTokens,
  assistantTokens,
  conversationTokens,
  toolResultTokens,
  onFileClick,
  onMouseEnter,
  onMouseLeave,
}: BreakdownPopoverProps) => {
  const fileToolCalls = toolCalls.filter(
    (t) =>
      ["Read", "Write", "Edit"].includes(t.name) &&
      t.input_summary.startsWith("/"),
  );

  const renderContent = () => {
    switch (segment) {
      case "system":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#8b5cf6" }}
              />
              System — {formatTokens(ctx.system_tokens)}
            </div>
            {injectedFiles.length > 0 ? (
              <div className="breakdown-popover-list">
                {injectedFiles.map((f, i) => (
                  <button
                    key={i}
                    className="breakdown-popover-item breakdown-popover-item--clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileClick(f.path);
                    }}
                  >
                    <span
                      className="breakdown-popover-file-dot"
                      style={{
                        background: CATEGORY_COLORS[f.category] || "#8e8e93",
                      }}
                    />
                    <span className="breakdown-popover-file-path">
                      {f.path.split("/").slice(-2).join("/")}
                    </span>
                    <span className="breakdown-popover-file-tokens">
                      {formatTokens(f.estimated_tokens)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="breakdown-popover-desc">No injected files</div>
            )}
          </>
        );
      case "userText":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#3b82f6" }}
              />
              Your Prompts — {formatTokens(userTextTokens)}
            </div>
            <div className="breakdown-popover-desc">
              Your text prompts in conversation
            </div>
          </>
        );
      case "assistant":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#60a5fa" }}
              />
              Responses — {formatTokens(assistantTokens)}
            </div>
            {scan.assistant_response ? (
              <div className="breakdown-popover-response">
                {scan.assistant_response.length > 200
                  ? scan.assistant_response.slice(0, 200) + "..."
                  : scan.assistant_response}
              </div>
            ) : (
              <div className="breakdown-popover-desc">
                Claude&apos;s responses in conversation
              </div>
            )}
          </>
        );
      case "messages":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#3b82f6" }}
              />
              Messages — {formatTokens(conversationTokens)}
            </div>
            <div className="breakdown-popover-desc">
              Conversation messages (prompts + responses)
            </div>
          </>
        );
      case "toolResult":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#06b6d4" }}
              />
              Action Results — {formatTokens(toolResultTokens)}
            </div>
            {fileToolCalls.length > 0 ? (
              <div className="breakdown-popover-list">
                {fileToolCalls.slice(0, 10).map((t) => (
                  <button
                    key={t.index}
                    className="breakdown-popover-item breakdown-popover-item--clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileClick(t.input_summary);
                    }}
                  >
                    <span
                      className="breakdown-popover-file-dot"
                      style={{
                        background: ACTION_COLORS[t.name] || "#8e8e93",
                      }}
                    />
                    <span className="breakdown-popover-badge">{t.name}</span>
                    <span className="breakdown-popover-file-path">
                      {t.input_summary.split("/").slice(-2).join("/")}
                    </span>
                  </button>
                ))}
                {fileToolCalls.length > 10 && (
                  <div className="breakdown-popover-desc">
                    +{fileToolCalls.length - 10} more
                  </div>
                )}
              </div>
            ) : (
              <div className="breakdown-popover-desc">
                Tool execution results
              </div>
            )}
          </>
        );
      case "toolsDef":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#f59e0b" }}
              />
              Tools Def — {formatTokens(ctx.tools_definition_tokens)}
            </div>
            <div className="breakdown-popover-desc">
              MCP tool definitions & schemas
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="breakdown-popover"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {renderContent()}
    </div>
  );
};

// --- File Preview Overlay (macOS style) ---

const FilePreviewOverlay = ({
  filePath,
  onClose,
}: {
  filePath: string;
  onClose: () => void;
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syntaxTheme, setSyntaxTheme] = useState<Record<
    string,
    React.CSSProperties
  > | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.api.readFileContent(filePath);
        if (result.error) setError(result.error);
        else setContent(result.content);
      } catch (err) {
        setError(String(err));
      }
    };
    load();
  }, [filePath]);

  useEffect(() => {
    syntaxThemePromise.then(setSyntaxTheme);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const shortName = filePath.split("/").slice(-2).join("/");
  const language = getLanguage(filePath);

  return (
    <motion.div
      className="file-preview-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        className="file-preview-panel"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        ref={overlayRef}
      >
        <div className="file-preview-header">
          <span className="file-preview-name">{shortName}</span>
          <span className="file-preview-lang">{language}</span>
          <button className="file-preview-close" onClick={onClose}>
            ESC
          </button>
        </div>
        <div className="file-preview-path">{filePath}</div>
        <div className="file-preview-body">
          {error ? (
            <div style={{ color: "#ff3b30", fontSize: 13 }}>{error}</div>
          ) : content === null ? (
            <div
              style={{ display: "flex", justifyContent: "center", padding: 20 }}
            >
              <div className="spinner" />
            </div>
          ) : syntaxTheme ? (
            <Suspense
              fallback={<pre className="file-preview-content">{content}</pre>}
            >
              <SyntaxHighlighter
                language={language}
                style={syntaxTheme}
                showLineNumbers
                customStyle={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.6,
                  borderRadius: 0,
                  background: "transparent",
                }}
                lineNumberStyle={{
                  minWidth: "2.5em",
                  paddingRight: "1em",
                  color: "#636d83",
                  userSelect: "none",
                }}
              >
                {content}
              </SyntaxHighlighter>
            </Suspense>
          ) : (
            <pre className="file-preview-content">{content}</pre>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
