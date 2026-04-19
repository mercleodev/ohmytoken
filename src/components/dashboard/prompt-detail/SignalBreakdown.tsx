import type { SignalResult } from "../../../types";
import { SIGNAL_COLORS, getConfidenceInfo } from "./constants";

type SignalBreakdownProps = {
  signals: SignalResult[];
  isOpen: boolean;
};

export const SignalBreakdown = ({ signals, isOpen }: SignalBreakdownProps) => (
  <div
    className={`collapsible ${isOpen ? "open" : ""}`}
    aria-hidden={!isOpen}
  >
    <div className="collapsible-inner">
      <div className="signal-breakdown">
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
      </div>
    </div>
  </div>
);
