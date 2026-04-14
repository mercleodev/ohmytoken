import { motion } from "framer-motion";
import type { SignalResult } from "../../../types";
import { SIGNAL_COLORS, getConfidenceInfo } from "./constants";

export const SignalBreakdown = ({ signals }: { signals: SignalResult[] }) => (
  <motion.div
    className="signal-breakdown"
    initial={{ height: 0, opacity: 0 }}
    animate={{ height: "auto", opacity: 1 }}
    exit={{ height: 0, opacity: 0 }}
    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
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
