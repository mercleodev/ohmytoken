import {
  formatCost,
  formatTokens,
  getContextLimit,
  getGaugeColor,
  getModelShort,
} from "../../scan/shared";
import type { PromptScan, UsageLogEntry } from "../../../types";

type ContextGaugeProps = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  cacheHitPct: number | null;
};

export const ContextGauge = ({ scan, usage, cacheHitPct }: ContextGaugeProps) => {
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

  return (
    <div className="prompt-detail-gauge">
      <div className="gauge-circle-container">
        <svg width={80} height={80} viewBox="0 0 80 80">
          <circle
            cx={40} cy={40} r={34} fill="none"
            stroke="var(--gauge-track, rgba(0,0,0,0.06))" strokeWidth={6}
          />
          <circle
            cx={40} cy={40} r={34} fill="none"
            stroke={gaugeColor} strokeWidth={6} strokeLinecap="round"
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
          <span>{formatTokens(ctx.total_tokens)} / {formatTokens(limit)}</span>
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
  );
};
