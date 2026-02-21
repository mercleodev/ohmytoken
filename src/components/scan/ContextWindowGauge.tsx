import {
  formatTokens,
  getContextLimit,
  getGaugeColor,
  getModelShort,
} from "./shared";

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
      style={{
        padding: "14px 16px",
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${pct > 75 ? "rgba(239, 68, 68, 0.3)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 12,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      {/* Circular gauge */}
      <div
        style={{
          position: "relative",
          width: 90,
          height: 90,
          flexShrink: 0,
        }}
      >
        <svg
          width={90}
          height={90}
          viewBox="0 0 90 90"
          style={{ transform: "rotate(-90deg)" }}
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
            style={{
              transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease",
            }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>
            {pct.toFixed(0)}%
          </span>
          <span style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
            used
          </span>
        </div>
      </div>

      {/* Right-side info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#e2e8f0",
            marginBottom: 6,
          }}
        >
          Context Window
        </div>

        <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 8 }}>
          <span style={{ fontWeight: 600, color }}>
            {formatTokens(totalTokens)}
          </span>
          <span style={{ color: "#64748b" }}> / {formatTokens(limit)}</span>
        </div>

        {/* Horizontal ratio bar (6-color) */}
        <div
          style={{
            display: "flex",
            height: 6,
            borderRadius: 3,
            overflow: "hidden",
            background: "rgba(255,255,255,0.08)",
            marginBottom: 6,
          }}
        >
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
        <div
          style={{ display: "flex", gap: 10, fontSize: 10, color: "#94a3b8" }}
        >
          <span>
            <span style={{ color: "#8b5cf6" }}>S</span>{" "}
            {formatTokens(systemTokens)}
          </span>
          {hasBd ? (
            <>
              <span>
                <span style={{ color: "#3b82f6" }}>P</span>{" "}
                {formatTokens(bd.user_text_tokens)}
              </span>
              <span>
                <span style={{ color: "#60a5fa" }}>R</span>{" "}
                {formatTokens(bd.assistant_tokens)}
              </span>
              {bd.tool_result_tokens > 0 && (
                <span>
                  <span style={{ color: "#06b6d4" }}>A</span>{" "}
                  {formatTokens(bd.tool_result_tokens)}
                </span>
              )}
            </>
          ) : (
            <span>
              <span style={{ color: "#3b82f6" }}>M</span>{" "}
              {formatTokens(messagesTokens)}
            </span>
          )}
          <span>
            <span style={{ color: "#f59e0b" }}>T</span>{" "}
            {formatTokens(toolsTokens)}
          </span>
          <span style={{ marginLeft: "auto", color: "#64748b" }}>
            {getModelShort(model)}
          </span>
        </div>
      </div>
    </div>
  );
};
