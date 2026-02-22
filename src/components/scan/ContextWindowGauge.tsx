import {
  formatTokens,
  getContextLimit,
  getGaugeColor,
  getModelShort,
} from "./shared";
import './scan.css';

type MessagesBreakdown = {
  user_text_tokens: number;
  assistant_tokens: number;
  tool_result_tokens: number;
};

type ContextWindowGaugeProps = {
  totalTokens: number;
  model: string;
  messagesTokens: number;
  systemTokens: number;
  toolsTokens: number;
  messagesBreakdown?: MessagesBreakdown;
};

export const ContextWindowGauge = ({
  totalTokens,
  model,
  messagesTokens,
  systemTokens,
  toolsTokens,
  messagesBreakdown,
}: ContextWindowGaugeProps) => {
  const limit = getContextLimit(model);
  const pct = Math.min((totalTokens / limit) * 100, 100);
  const color = getGaugeColor(pct);

  // Circular gauge SVG parameters
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  const bd = messagesBreakdown;
  const hasBd =
    bd &&
    (bd.user_text_tokens > 0 ||
      bd.assistant_tokens > 0 ||
      bd.tool_result_tokens > 0);

  return (
    <div
      className="scan-gauge"
      style={{
        border: `1px solid ${pct > 75 ? "rgba(239, 68, 68, 0.3)" : "rgba(255,255,255,0.08)"}`,
      }}
    >
      {/* Circular gauge */}
      <div className="scan-gauge__circle-wrap">
        <svg
          className="scan-gauge__svg"
          width={90}
          height={90}
          viewBox="0 0 90 90"
        >
          <circle
            cx={45}
            cy={45}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={7}
          />
          <circle
            cx={45}
            cy={45}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="scan-gauge__stroke-transition"
          />
        </svg>
        <div className="scan-gauge__center">
          <span className="scan-gauge__pct" style={{ color }}>
            {pct.toFixed(0)}%
          </span>
          <span className="scan-gauge__used-label">
            used
          </span>
        </div>
      </div>

      {/* Right-side info */}
      <div className="scan-gauge__info">
        <div className="scan-gauge__title">
          Context Window
        </div>

        <div className="scan-gauge__token-count">
          <span style={{ fontWeight: 600, color }}>
            {formatTokens(totalTokens)}
          </span>
          <span className="scan-gauge__token-limit"> / {formatTokens(limit)}</span>
        </div>

        {/* Horizontal ratio bar (6-color) */}
        <div className="scan-gauge__ratio-bar">
          <div
            style={{
              width: `${(systemTokens / limit) * 100}%`,
              background: "#8b5cf6",
            }}
          />
          {hasBd ? (
            <>
              <div
                style={{
                  width: `${(bd.user_text_tokens / limit) * 100}%`,
                  background: "#3b82f6",
                }}
              />
              <div
                style={{
                  width: `${(bd.assistant_tokens / limit) * 100}%`,
                  background: "#60a5fa",
                }}
              />
              <div
                style={{
                  width: `${(bd.tool_result_tokens / limit) * 100}%`,
                  background: "#06b6d4",
                }}
              />
            </>
          ) : (
            <div
              style={{
                width: `${(messagesTokens / limit) * 100}%`,
                background: "#3b82f6",
              }}
            />
          )}
          <div
            style={{
              width: `${(toolsTokens / limit) * 100}%`,
              background: "#f59e0b",
            }}
          />
        </div>

        {/* Legend */}
        <div className="scan-gauge__legend">
          <span>
            <span className="scan-gauge__legend-item--system">S</span>{" "}
            {formatTokens(systemTokens)}
          </span>
          {hasBd ? (
            <>
              <span>
                <span className="scan-gauge__legend-item--messages">P</span>{" "}
                {formatTokens(bd.user_text_tokens)}
              </span>
              <span>
                <span className="scan-gauge__legend-item--messages-light">R</span>{" "}
                {formatTokens(bd.assistant_tokens)}
              </span>
              {bd.tool_result_tokens > 0 && (
                <span>
                  <span className="scan-gauge__legend-item--tool-result">A</span>{" "}
                  {formatTokens(bd.tool_result_tokens)}
                </span>
              )}
            </>
          ) : (
            <span>
              <span className="scan-gauge__legend-item--messages">M</span>{" "}
              {formatTokens(messagesTokens)}
            </span>
          )}
          <span>
            <span className="scan-gauge__legend-item--tools">T</span>{" "}
            {formatTokens(toolsTokens)}
          </span>
          <span className="scan-gauge__legend-model">
            {getModelShort(model)}
          </span>
        </div>
      </div>
    </div>
  );
};
