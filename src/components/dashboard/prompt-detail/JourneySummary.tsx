import { formatTokens } from "../../scan/shared";
import type { PromptScan, UsageLogEntry } from "../../../types";

type JourneySummaryProps = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  cacheHitPct: number | null;
};

export const JourneySummary = ({ scan, usage, cacheHitPct }: JourneySummaryProps) => {
  const isClaude = (scan.provider ?? "claude") === "claude";
  const injectedFiles = scan.injected_files ?? [];
  const toolCalls = scan.tool_calls ?? [];
  const actionCounts = Object.entries(scan.tool_summary ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // For non-Claude providers without individual tool_calls, derive count from tool_summary
  const actionCountValue = toolCalls.length > 0
    ? toolCalls.length
    : Object.values(scan.tool_summary ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="journey-summary">
      <div className="journey-summary-title">Prompt Journey</div>
      <div className="journey-summary-grid">
        <div className="journey-summary-card">
          <div className="journey-summary-label">Prompt</div>
          <div className="journey-summary-value">
            {formatTokens(scan.user_prompt_tokens || 0)} tokens
          </div>
        </div>
        {isClaude && (
          <div className="journey-summary-card">
            <div className="journey-summary-label">Injected</div>
            <div className="journey-summary-value">
              {injectedFiles.length} files · {formatTokens(scan.total_injected_tokens || 0)}
            </div>
          </div>
        )}
        <div className="journey-summary-card">
          <div className="journey-summary-label">Actions</div>
          <div className="journey-summary-value">{actionCountValue} calls</div>
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
    </div>
  );
};
