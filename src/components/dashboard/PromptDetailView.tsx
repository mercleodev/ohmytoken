import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import {
  formatCost,
  formatTokens,
  getContextLimit,
  getGaugeColor,
  getModelShort,
  CATEGORY_COLORS,
} from "../scan/shared";
import { ContextTreemap } from "./ContextTreemap";
import { ActionFlowList } from "./ActionFlowList";
import type { PromptScan, UsageLogEntry } from "../../types";
import {
  StatPill,
  Section,
  LegendDot,
  TokenRow,
  EvidenceGroup,
  BreakdownPopover,
  FilePreviewOverlay,
  buildInjectedEvidence,
  CONTINUATION_PROMPT_MARKER,
  SESSION_SCAN_DEDUP_MS,
  COMPACTION_DROP_RATIO,
  MIN_COMPACTION_BASE_TOKENS,
} from "./promptDetail";

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
              (prev.user_prompt || "").trim() ===
              (item.user_prompt || "").trim();
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
          const previousTokens =
            previous?.context_estimate?.total_tokens ?? 0;
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
              {injectedFiles.length} files ·{" "}
              {formatTokens(scan.total_injected_tokens || 0)}
            </div>
          </div>
          <div className="journey-summary-card">
            <div className="journey-summary-label">Actions</div>
            <div className="journey-summary-value">
              {toolCalls.length} calls
            </div>
            {actionCounts.length > 0 && (
              <div className="journey-summary-sub">
                {actionCounts
                  .map(([name, cnt]) => `${name}×${cnt}`)
                  .join(" · ")}
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
                Read {formatTokens(usage.response.cache_read_input_tokens)}{" "}
                tokens
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
                    style={{
                      width: `${assistantPct}%`,
                      background: "#60a5fa",
                    }}
                    onMouseEnter={() => setHoveredSegment("assistant")}
                    onMouseLeave={() => setHoveredSegment(null)}
                  />
                )}
              </>
            ) : (
              <div
                className="ctx-segment"
                style={{
                  width: `${conversationPct}%`,
                  background: "#3b82f6",
                }}
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
