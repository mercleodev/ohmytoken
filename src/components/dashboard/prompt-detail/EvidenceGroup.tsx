import { useState, useCallback } from "react";
import { formatTokens } from "../../scan/shared";
import type { EvidenceStatus, InjectedEvidenceItem } from "./types";
import { EVIDENCE_STATUS_COLORS } from "./constants";
import { SignalBreakdown } from "./SignalBreakdown";

export const EvidenceGroup = ({
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
              {item.signals && (
                <SignalBreakdown signals={item.signals} isOpen={isExpanded} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
