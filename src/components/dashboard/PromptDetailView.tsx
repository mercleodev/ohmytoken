import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
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
import { EvidenceSettings } from "./EvidenceSettings";
import type { PromptScan, UsageLogEntry, EvidenceReport, SignalResult } from "../../types";

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
  normalizedScore?: number;
  signals?: SignalResult[];
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const getFileName = (pathValue: string): string =>
  pathValue.split("/").filter(Boolean).pop() ?? pathValue;

/**
 * Build evidence classification from either:
 * 1. EvidenceReport (scoring engine) — preferred, multi-signal analysis
 * 2. Fallback: simple filename matching (legacy behavior)
 */
const buildInjectedEvidence = (scan: PromptScan): Record<
  EvidenceStatus,
  InjectedEvidenceItem[]
> => {
  // Use evidence scoring engine report if available
  const report = scan.evidence_report;
  if (report && report.files.length > 0) {
    return buildFromEvidenceReport(report, scan);
  }

  // Fallback: legacy filename-matching classification
  return buildLegacyEvidence(scan);
};

const buildFromEvidenceReport = (
  report: EvidenceReport,
  scan: PromptScan,
): Record<EvidenceStatus, InjectedEvidenceItem[]> => {
  const byStatus: Record<EvidenceStatus, InjectedEvidenceItem[]> = {
    confirmed: [],
    likely: [],
    unverified: [],
  };

  for (const fileScore of report.files) {
    // Find matching injected file for tokens
    const injected = scan.injected_files?.find(
      (f) => f.path === fileScore.filePath,
    );

    const topSignal = fileScore.signals
      .filter((s: SignalResult) => s.score > 0)
      .sort((a: SignalResult, b: SignalResult) => b.score - a.score)[0];

    const reason = topSignal
      ? `${topSignal.detail} (score: ${fileScore.normalizedScore.toFixed(2)})`
      : `Score: ${fileScore.normalizedScore.toFixed(2)}`;

    const item: InjectedEvidenceItem = {
      path: fileScore.filePath,
      category: (injected?.category ?? fileScore.category) as InjectedEvidenceItem["category"],
      estimated_tokens: injected?.estimated_tokens ?? 0,
      status: fileScore.classification,
      reason,
      normalizedScore: fileScore.normalizedScore,
      signals: fileScore.signals,
    };

    byStatus[fileScore.classification as EvidenceStatus].push(item);
  }

  // Sort each group by tokens descending
  for (const status of ["confirmed", "likely", "unverified"] as const) {
    byStatus[status].sort((a, b) => b.estimated_tokens - a.estimated_tokens);
  }

  return byStatus;
};

const buildLegacyEvidence = (scan: PromptScan): Record<
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
        status: "confirmed" as const,
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
        status: "likely" as const,
        reason,
      };
    }

    return {
      ...file,
      status: "unverified" as const,
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
    () => new Set(["injected-evidence"]),
  );
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [expandedActions, setExpandedActions] = useState<Set<number>>(
    () => new Set(),
  );
  const [sessionCompactions, setSessionCompactions] = useState<number | null>(
    null,
  );
  const [enrichedScan, setEnrichedScan] = useState<PromptScan>(scan);
  const [showEvidenceSettings, setShowEvidenceSettings] = useState(false);
  const [activeTools, setActiveTools] = useState<Set<string> | "all">("all");

  // Fetch evidence report if not already attached; auto-rescore if missing
  useEffect(() => {
    if (scan.evidence_report) {
      setEnrichedScan(scan);
      return;
    }
    let cancelled = false;

    const loadOrRescore = async () => {
      // 1. Try to load from DB
      const existing = await window.api?.getEvidenceReport?.(scan.request_id).catch(() => null);
      if (cancelled) return;
      if (existing) {
        setEnrichedScan({ ...scan, evidence_report: existing });
        return;
      }
      // 2. Auto rescore if not in DB
      const report = await window.api?.rescoreEvidence?.(scan.request_id).catch(() => null);
      if (cancelled || !report) return;
      setEnrichedScan({ ...scan, evidence_report: report });
    };

    loadOrRescore();

    // Listen for real-time evidence scoring
    const unsub = window.api?.onEvidenceScored?.((data) => {
      if (data.requestId === scan.request_id) {
        setEnrichedScan((prev) => ({ ...prev, evidence_report: data.report }));
      }
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [scan.request_id, scan.evidence_report]);

  const handleRescore = useCallback(async () => {
    const report = await window.api?.rescoreEvidence?.(scan.request_id);
    if (report) {
      setEnrichedScan((prev) => ({ ...prev, evidence_report: report }));
    }
  }, [scan.request_id]);

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
  // Tool filter: extract unique tool names sorted by frequency
  const toolNameOptions = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const tc of toolCalls) {
      freq[tc.name] = (freq[tc.name] ?? 0) + 1;
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [toolCalls]);

  const filteredToolCalls = useMemo(() => {
    if (activeTools === "all") return toolCalls;
    if (activeTools.size === 0) return toolCalls;
    return toolCalls.filter((tc) => activeTools.has(tc.name));
  }, [toolCalls, activeTools]);

  const injectedEvidence = buildInjectedEvidence(enrichedScan);
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
        headerExtra={
          <button
            className="evidence-settings-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowEvidenceSettings(true);
            }}
            aria-label="Evidence scoring settings"
          >
            &#x2699;
          </button>
        }
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

      {/* Evidence Settings Overlay */}
      <AnimatePresence>
        {showEvidenceSettings && (
          <EvidenceSettings
            onClose={() => setShowEvidenceSettings(false)}
            onSave={handleRescore}
          />
        )}
      </AnimatePresence>

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
          <>
            <ActionFilterChips
              options={toolNameOptions}
              activeTools={activeTools}
              onToggle={(name) => {
                if (name === "all") {
                  setActiveTools("all");
                  return;
                }
                setActiveTools((prev) => {
                  const allNames = toolNameOptions.map((o) => o.name);
                  let next: Set<string>;
                  if (prev === "all") {
                    next = new Set(allNames);
                  } else {
                    next = new Set(prev);
                  }
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  if (next.size === allNames.length) return "all";
                  if (next.size === 0) return "all";
                  return next;
                });
              }}
              totalCount={toolCalls.length}
              filteredCount={filteredToolCalls.length}
            />
            <ActionFlowList
              toolCalls={filteredToolCalls}
              expandedActions={expandedActions}
              onToggleAction={toggleAction}
              onOpenFile={setPreviewFile}
              scanTimestamp={scan.timestamp}
              isCompleted={isPromptCompleted}
            />
          </>
        ) : (
          <div className="section-empty">No actions</div>
        )}
      </Section>

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
  headerExtra?: React.ReactNode;
};

const Section = ({ title, id, expanded, onToggle, children, headerExtra }: SectionProps) => {
  const isOpen = expanded.has(id);
  return (
    <div className="detail-section">
      <button className="detail-section-header" onClick={() => onToggle(id)}>
        <span>{title}</span>
        <span className="detail-section-header-right">
          {headerExtra}
          <span className={`detail-section-chevron ${isOpen ? "expanded" : ""}`}>
            ›
          </span>
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

const EVIDENCE_STATUS_COLORS: Record<EvidenceStatus, string> = {
  confirmed: "#1f7a57",
  likely: "#d18f1d",
  unverified: "#9ca3af",
};

const SIGNAL_COLORS: Record<string, string> = {
  "category-prior": "#8b5cf6",
  "text-overlap": "#3b82f6",
  "instruction-compliance": "#06b6d4",
  "tool-reference": "#f59e0b",
  "position-effect": "#ec4899",
  "token-proportion": "#10b981",
  "session-history": "#6366f1",
};

const CONFIDENCE_LEVELS = [
  { min: 0.7, label: "High", color: "#1f7a57" },
  { min: 0.4, label: "Med", color: "#d18f1d" },
  { min: 0, label: "Low", color: "#9ca3af" },
] as const;

const getConfidenceInfo = (confidence: number) =>
  CONFIDENCE_LEVELS.find((l) => confidence >= l.min) ?? CONFIDENCE_LEVELS[2];

const SignalBreakdown = ({ signals }: { signals: SignalResult[] }) => (
  <motion.div
    className="signal-breakdown"
    initial={{ height: 0, opacity: 0 }}
    animate={{ height: "auto", opacity: 1 }}
    exit={{ height: 0, opacity: 0 }}
    transition={{ duration: 0.2 }}
    style={{ overflow: "hidden" }}
  >
    {signals.map((signal) => {
      const pct = signal.maxScore > 0 ? (signal.score / signal.maxScore) * 100 : 0;
      const ci = getConfidenceInfo(signal.confidence);
      return (
        <div key={signal.signalId} className="signal-breakdown-row">
          <span className="signal-breakdown-name">{signal.signalId}</span>
          <span className="signal-breakdown-score">
            {signal.score.toFixed(1)}/{signal.maxScore}
          </span>
          <span className="signal-bar-track">
            <span
              className="signal-bar-fill"
              style={{
                width: `${pct}%`,
                background: SIGNAL_COLORS[signal.signalId] ?? "#6366f1",
              }}
            />
          </span>
          <span
            className="signal-confidence-dot"
            style={{ background: ci.color }}
            title={`Confidence: ${ci.label} (${signal.confidence.toFixed(2)})`}
          />
        </div>
      );
    })}
  </motion.div>
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
  const [expandedBreakdowns, setExpandedBreakdowns] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleBreakdown = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedBreakdowns((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  const barColor = EVIDENCE_STATUS_COLORS[status];

  return (
    <div className="injected-evidence-group">
      <div className="injected-evidence-group-title">
        <span className={`injected-evidence-dot ${status}`} />
        <span>{title}</span>
      </div>
      <div className="injected-evidence-list">
        {items.map((item) => {
          const hasSignals = item.signals && item.signals.length > 0;
          const scorePct = item.normalizedScore != null
            ? Math.round(item.normalizedScore * 100)
            : null;
          const isExpanded = expandedBreakdowns.has(item.path);

          return (
            <div key={`${status}-${item.path}`} className="injected-evidence-entry">
              <button
                className="injected-evidence-item"
                onClick={() => onOpenFile(item.path)}
              >
                <span className="injected-evidence-item-main">
                  <span className="injected-evidence-item-path">
                    {item.path.split("/").slice(-2).join("/")}
                  </span>
                  <span className="injected-evidence-item-reason">{item.reason}</span>
                </span>
                <span className="injected-evidence-item-right">
                  {scorePct !== null && (
                    <span className="evidence-score-pct">{scorePct}%</span>
                  )}
                  <span className="injected-evidence-item-tokens">
                    {formatTokens(item.estimated_tokens)}
                  </span>
                  {hasSignals && (
                    <button
                      className={`evidence-breakdown-toggle${isExpanded ? " expanded" : ""}`}
                      onClick={(e) => toggleBreakdown(item.path, e)}
                      aria-label={isExpanded ? "Hide signal breakdown" : "Show signal breakdown"}
                    >
                      {isExpanded ? "\u25B4" : "\u25BE"}
                    </button>
                  )}
                </span>
              </button>
              {scorePct !== null && (
                <div className="evidence-score-bar">
                  <div
                    className="evidence-score-fill"
                    style={{ width: `${scorePct}%`, background: barColor }}
                  />
                </div>
              )}
              <AnimatePresence>
                {isExpanded && item.signals && (
                  <SignalBreakdown signals={item.signals} />
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- Action Filter Chips ---

type ActionFilterChipsProps = {
  options: Array<{ name: string; count: number }>;
  activeTools: Set<string> | "all";
  onToggle: (name: string) => void;
  totalCount: number;
  filteredCount: number;
};

const ActionFilterChips = ({
  options,
  activeTools,
  onToggle,
  totalCount,
  filteredCount,
}: ActionFilterChipsProps) => (
  <div className="action-filter-chips">
    <div className="action-filter-chips-row">
      <button
        className={`action-filter-chip preset${activeTools === "all" ? " active" : ""}`}
        style={{ "--chip-color": "#8e8e93" } as React.CSSProperties}
        onClick={() => onToggle("all")}
        aria-label="Show all tools"
      >
        All
      </button>
      <span className="action-filter-divider" />
      {options.map(({ name, count }) => {
        const active = activeTools === "all" || activeTools.has(name);
        return (
          <button
            key={name}
            className={`action-filter-chip${active ? " active" : ""}`}
            style={{
              "--chip-color": ACTION_COLORS[name] || "#8e8e93",
            } as React.CSSProperties}
            onClick={() => onToggle(name)}
            aria-label={`Toggle ${name}`}
          >
            <span
              className="action-filter-chip-dot"
              style={{ background: ACTION_COLORS[name] || "#8e8e93" }}
            />
            {name} ({count})
          </button>
        );
      })}
    </div>
    {activeTools !== "all" && (
      <span className="action-filter-chips-count">
        {filteredCount} / {totalCount}
      </span>
    )}
  </div>
);

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
