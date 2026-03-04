import { useState, useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import {
  formatTokens,
  getContextLimit,
  getGaugeColor,
  getModelShort,
  CATEGORY_COLORS,
} from "../scan/shared";
import { ContextTreemap } from "./ContextTreemap";
import { ActionFlowList } from "./ActionFlowList";
import { EvidenceSettings } from "./EvidenceSettings";
import type { PromptScan, UsageLogEntry } from "../../types";
import { usePromptDetail } from "./prompt-detail/usePromptDetail";
import { buildInjectedEvidence } from "./prompt-detail/evidence";
import { StatPill } from "./prompt-detail/StatPill";
import { Section } from "./prompt-detail/Section";
import { EvidenceGroup } from "./prompt-detail/EvidenceGroup";
import { ActionFilterChips } from "./prompt-detail/ActionFilterChips";
import { FilePreviewOverlay } from "./prompt-detail/FilePreviewOverlay";
import { ContextGauge } from "./prompt-detail/ContextGauge";
import { JourneySummary } from "./prompt-detail/JourneySummary";

type PromptDetailViewProps = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  onBack: () => void;
};

export const PromptDetailView = ({ scan, usage, onBack }: PromptDetailViewProps) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["injected-evidence"]),
  );
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [expandedActions, setExpandedActions] = useState<Set<number>>(() => new Set());
  const [showEvidenceSettings, setShowEvidenceSettings] = useState(false);
  const [activeTools, setActiveTools] = useState<Set<string> | "all">("all");

  const { enrichedScan, sessionCompactions, handleRescore } = usePromptDetail(scan);

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

  const gaugeColor = getGaugeColor(
    (() => {
      const ctx = scan.context_estimate ?? { total_tokens: 0 };
      const limit = getContextLimit(scan.model ?? "");
      return ctx.total_tokens > 0 ? Math.min((ctx.total_tokens / limit) * 100, 100) : 0;
    })(),
  );

  const injectedFiles = scan.injected_files ?? [];
  const toolCalls = scan.tool_calls ?? [];
  const hasAssistantResponse = Boolean(scan.assistant_response?.trim());
  const hasOutputTokens = (usage?.response.output_tokens ?? 0) > 0;
  const isPromptCompleted = hasAssistantResponse || hasOutputTokens;

  const isClaude = (scan.provider ?? "claude") === "claude";
  const hasDetailedBreakdown = (scan.context_estimate?.system_tokens ?? 0) > 0
    || (scan.context_estimate?.messages_tokens ?? 0) > 0;
  const hasInjectedFiles = injectedFiles.length > 0;
  const hasToolCalls = toolCalls.length > 0;
  const hasToolSummary = Object.keys(scan.tool_summary ?? {}).length > 0;
  const isLimitedProvider = !hasDetailedBreakdown && !hasInjectedFiles && !hasToolCalls && !hasToolSummary;

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
    return toolCalls.filter((tc) => activeTools.has(tc.name));
  }, [toolCalls, activeTools]);

  const handleToolToggle = useCallback(
    (name: string) => {
      if (name === "all") {
        setActiveTools((prev) => (prev === "all" ? new Set<string>() : "all"));
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
        return next;
      });
    },
    [toolNameOptions],
  );

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

  return (
    <div>
      {/* Header */}
      <div className="prompt-detail-header">
        <button className="session-back-btn" onClick={onBack}>‹ Back</button>
        <span className="prompt-detail-model" style={{ color: gaugeColor }}>
          {getModelShort(scan.model)}
        </span>
      </div>

      {/* Prompt Text */}
      <div
        className={`prompt-detail-text${promptExpanded ? " expanded" : ""}`}
        onClick={() =>
          scan.user_prompt && scan.user_prompt.length > 100 && setPromptExpanded((v) => !v)
        }
        style={scan.user_prompt && scan.user_prompt.length > 100 ? { cursor: "pointer" } : undefined}
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
        <Section title="Response" id="response" expanded={expandedSections} onToggle={toggle}>
          <div className="response-section">{scan.assistant_response}</div>
        </Section>
      )}

      <ContextGauge scan={scan} usage={usage} cacheHitPct={cacheHitPct} />
      <ContextTreemap scan={scan} onFileClick={(path) => setPreviewFile(path)} />

      {/* Provider data limitation notice */}
      {isLimitedProvider && (
        <div className="provider-data-notice">
          Token breakdown and file/action details are not available for this provider.
        </div>
      )}

      {/* Quick Stats */}
      <div className="prompt-detail-stats">
        <StatPill label="Turns" value={String(scan.conversation_turns ?? 0)} />
        <StatPill label="Tools" value={String(
          toolCalls.length > 0
            ? toolCalls.length
            : Object.values(scan.tool_summary ?? {}).reduce((a, b) => a + b, 0)
        )} />
        {isClaude && <StatPill label="Files" value={String(injectedFiles.length)} />}
        <StatPill label="Compactions" value={sessionCompactions === null ? "..." : String(sessionCompactions)} />
        {usage && <StatPill label="Duration" value={`${(usage.duration_ms / 1000).toFixed(1)}s`} />}
      </div>

      <JourneySummary scan={scan} usage={usage} cacheHitPct={cacheHitPct} onFileClick={setPreviewFile} />

      {/* Injected Evidence — only for Claude provider */}
      {isClaude && hasInjectedFiles && (
        <Section
          title={`Injected Evidence (C ${injectedEvidence.confirmed.length} · L ${injectedEvidence.likely.length} · U ${injectedEvidence.unverified.length})`}
          id="injected-evidence"
          expanded={expandedSections}
          onToggle={toggle}
          headerExtra={
            <button className="evidence-settings-btn" onClick={(e) => { e.stopPropagation(); setShowEvidenceSettings(true); }} aria-label="Evidence scoring settings">
              &#x2699;
            </button>
          }
        >
          <div className="injected-evidence-summary">
            <span className="injected-evidence-badge confirmed">Confirmed {injectedEvidence.confirmed.length}</span>
            <span className="injected-evidence-badge likely">Likely {injectedEvidence.likely.length}</span>
            <span className="injected-evidence-badge unverified">Unverified {injectedEvidence.unverified.length}</span>
          </div>
          <EvidenceGroup title="Confirmed" status="confirmed" items={injectedEvidence.confirmed} onOpenFile={setPreviewFile} />
          <EvidenceGroup title="Likely" status="likely" items={injectedEvidence.likely} onOpenFile={setPreviewFile} />
          <EvidenceGroup title="Unverified" status="unverified" items={injectedEvidence.unverified} onOpenFile={setPreviewFile} />
        </Section>
      )}

      <AnimatePresence>
        {showEvidenceSettings && <EvidenceSettings onClose={() => setShowEvidenceSettings(false)} onSave={handleRescore} />}
      </AnimatePresence>

      {/* Injected Files — only for Claude provider */}
      {isClaude && (
        <Section title={`Injected Files (${injectedFiles.length})`} id="files" expanded={expandedSections} onToggle={toggle}>
          {injectedFiles.length > 0 ? (
            <div className="file-list">
              {injectedFiles.map((f, i) => (
                <button key={i} className="file-item" onClick={() => setPreviewFile(f.path)}>
                  <span className="file-dot" style={{ background: CATEGORY_COLORS[f.category] || "#8e8e93" }} />
                  <span className="file-path">{f.path.split("/").slice(-2).join("/")}</span>
                  <span className="file-tokens">{formatTokens(f.estimated_tokens)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="section-empty">No injected files</div>
          )}
        </Section>
      )}

      {/* Actions */}
      <Section title={`Actions (${toolCalls.length})`} id="tools" expanded={expandedSections} onToggle={toggle}>
        {toolCalls.length > 0 ? (
          <>
            <ActionFilterChips options={toolNameOptions} activeTools={activeTools} onToggle={handleToolToggle} totalCount={toolCalls.length} filteredCount={filteredToolCalls.length} />
            <ActionFlowList toolCalls={filteredToolCalls} expandedActions={expandedActions} onToggleAction={toggleAction} onOpenFile={setPreviewFile} scanTimestamp={scan.timestamp} isCompleted={isPromptCompleted} />
          </>
        ) : (
          <div className="section-empty">No actions</div>
        )}
      </Section>

      <AnimatePresence>
        {previewFile && <FilePreviewOverlay filePath={previewFile} onClose={() => setPreviewFile(null)} />}
      </AnimatePresence>
    </div>
  );
};
