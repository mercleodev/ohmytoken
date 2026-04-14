import { useState, useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import {
  formatTokens,
  getContextLimit,
  getGaugeColor,
  getModelShort,
} from "../scan/shared";
import { ContextTreemap } from "./ContextTreemap";
import { ActionFlowList } from "./ActionFlowList";
import { EvidenceSettings } from "./EvidenceSettings";
import type { PromptScan, UsageLogEntry } from "../../types";
import { usePromptDetail } from "./prompt-detail/usePromptDetail";
import { buildInjectedEvidence } from "./prompt-detail/evidence";
import { StatPill } from "./prompt-detail/StatPill";
import { Section } from "./prompt-detail/Section";
import { ContextFileList } from "./prompt-detail/ContextFileList";
import { ActionFilterChips } from "./prompt-detail/ActionFilterChips";
import { FilePreviewOverlay } from "./prompt-detail/FilePreviewOverlay";
import { ContextGauge } from "./prompt-detail/ContextGauge";
import { GuardrailSummary } from "./prompt-detail/GuardrailSummary";
import { JourneySummary } from "./prompt-detail/JourneySummary";
import { PromptMemorySection } from "./prompt-detail/PromptMemorySection";

type PromptDetailViewProps = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  onBack: () => void;
};

export const PromptDetailView = ({ scan, usage, onBack }: PromptDetailViewProps) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["context-files", "memory", "tools"]),
  );
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [expandedActions, setExpandedActions] = useState<Set<number>>(() => new Set());
  const [showEvidenceSettings, setShowEvidenceSettings] = useState(false);
  const [activeTools, setActiveTools] = useState<Set<string> | "all">("all");

  const { enrichedScan, sessionCompactions, guardrailAssessment, handleRescore, lowUtilizationPaths } = usePromptDetail(scan, usage);

  // Use enrichedScan as primary data source (may have richer JSONL-parsed data)
  const displayScan = enrichedScan;

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
      const ctx = displayScan.context_estimate ?? { total_tokens: 0 };
      const limit = getContextLimit(displayScan.model ?? "");
      return ctx.total_tokens > 0 ? Math.min((ctx.total_tokens / limit) * 100, 100) : 0;
    })(),
  );

  const injectedFiles = displayScan.injected_files ?? [];
  const toolCalls = displayScan.tool_calls ?? [];
  const hasAssistantResponse = Boolean(displayScan.assistant_response?.trim());
  const hasOutputTokens = (usage?.response.output_tokens ?? 0) > 0;
  const isPromptCompleted = hasAssistantResponse || hasOutputTokens;

  const hasDetailedBreakdown = (displayScan.context_estimate?.system_tokens ?? 0) > 0
    || (displayScan.context_estimate?.messages_tokens ?? 0) > 0;
  const hasInjectedFiles = injectedFiles.length > 0;
  const hasToolCalls = toolCalls.length > 0;
  const hasAnyData = hasDetailedBreakdown || hasInjectedFiles || hasToolCalls
    || (displayScan.context_estimate?.total_tokens ?? 0) > 0;
  const isLimitedProvider = !hasAnyData;

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

  const injectedEvidence = buildInjectedEvidence(displayScan);
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
          {getModelShort(displayScan.model)}
        </span>
        {displayScan.git_branch && (
          <span className="prompt-detail-branch">{displayScan.git_branch}</span>
        )}
      </div>

      {/* Prompt Text */}
      <div
        className={`prompt-detail-text${promptExpanded ? " expanded" : ""}`}
        onClick={() =>
          displayScan.user_prompt && displayScan.user_prompt.length > 100 && setPromptExpanded((v) => !v)
        }
        style={displayScan.user_prompt && displayScan.user_prompt.length > 100 ? { cursor: "pointer" } : undefined}
      >
        {!displayScan.user_prompt
          ? "(system request)"
          : promptExpanded
            ? displayScan.user_prompt
            : displayScan.user_prompt.length > 100
              ? displayScan.user_prompt.slice(0, 100) + "..."
              : displayScan.user_prompt}
      </div>

      {/* Response Preview */}
      {displayScan.assistant_response && (
        <Section title="Response" id="response" expanded={expandedSections} onToggle={toggle}>
          <div className="response-section">{displayScan.assistant_response}</div>
        </Section>
      )}

      <ContextGauge scan={displayScan} usage={usage} cacheHitPct={cacheHitPct} />
      <ContextTreemap scan={displayScan} onFileClick={(path) => setPreviewFile(path)} />

      {/* Guardrail Summary (after ContextGauge, before JourneySummary) */}
      <GuardrailSummary assessment={guardrailAssessment} />

      {/* Provider data limitation notice */}
      {isLimitedProvider && (
        <div className="provider-data-notice">
          Token breakdown and file/action details are not available for this provider.
        </div>
      )}

      {/* Quick Stats */}
      <div className="prompt-detail-stats">
        <StatPill label="Turns" value={String(displayScan.conversation_turns ?? 0)} />
        <StatPill label="Tools" value={String(toolCalls.length)} />
        <StatPill label="Files" value={String(injectedFiles.length)} />
        <StatPill label="Compactions" value={sessionCompactions === null ? "..." : String(sessionCompactions)} />
        {usage && <StatPill label="Duration" value={`${(usage.duration_ms / 1000).toFixed(1)}s`} />}
      </div>

      <JourneySummary scan={displayScan} usage={usage} cacheHitPct={cacheHitPct} />

      {/* Context Files (merged evidence + files) */}
      {hasInjectedFiles && (
        <Section
          title={`Context Files (${injectedFiles.length}) · ${formatTokens(injectedFiles.reduce((sum, f) => sum + f.estimated_tokens, 0))}`}
          id="context-files"
          expanded={expandedSections}
          onToggle={toggle}
          headerExtra={
            <>
              <span className="injected-evidence-badge confirmed">C {injectedEvidence.confirmed.length}</span>
              <span className="injected-evidence-badge likely">L {injectedEvidence.likely.length}</span>
              <span className="injected-evidence-badge unverified">U {injectedEvidence.unverified.length}</span>
              <button className="evidence-settings-btn" onClick={(e) => { e.stopPropagation(); setShowEvidenceSettings(true); }} aria-label="Evidence scoring settings">
                &#x2699;
              </button>
            </>
          }
        >
          <ContextFileList
            evidence={injectedEvidence}
            lowUtilizationPaths={lowUtilizationPaths}
            onOpenFile={setPreviewFile}
          />
        </Section>
      )}

      <AnimatePresence>
        {showEvidenceSettings && <EvidenceSettings onClose={() => setShowEvidenceSettings(false)} onSave={handleRescore} />}
      </AnimatePresence>

      {/* Claude Memory */}
      <PromptMemorySection projectPath={displayScan.project_path} expanded={expandedSections} onToggle={toggle} />

      {/* Actions */}
      <Section title={`Actions (${toolCalls.length})`} id="tools" expanded={expandedSections} onToggle={toggle}>
        {toolCalls.length > 0 ? (
          <>
            <ActionFilterChips options={toolNameOptions} activeTools={activeTools} onToggle={handleToolToggle} totalCount={toolCalls.length} filteredCount={filteredToolCalls.length} />
            <ActionFlowList toolCalls={filteredToolCalls} expandedActions={expandedActions} onToggleAction={toggleAction} onOpenFile={setPreviewFile} scanTimestamp={displayScan.timestamp} isCompleted={isPromptCompleted} />
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
