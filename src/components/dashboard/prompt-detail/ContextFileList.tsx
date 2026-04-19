import { useState, useCallback, useMemo } from "react";
import { formatTokens } from "../../scan/shared";
import type { EvidenceStatus, InjectedEvidenceItem } from "./types";
import { EVIDENCE_STATUS_COLORS } from "./constants";
import { SignalBreakdown } from "./SignalBreakdown";

const STATUS_ORDER: Record<EvidenceStatus, number> = {
  confirmed: 0,
  likely: 1,
  unverified: 2,
};

const STATUS_LABEL: Record<EvidenceStatus, string> = {
  confirmed: "C",
  likely: "L",
  unverified: "U",
};

type ContextFileListProps = {
  evidence: Record<EvidenceStatus, InjectedEvidenceItem[]>;
  lowUtilizationPaths: Set<string>;
  onOpenFile: (path: string) => void;
};

export const ContextFileList = ({
  evidence,
  lowUtilizationPaths,
  onOpenFile,
}: ContextFileListProps) => {
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

  const allItems = useMemo(() => {
    const items: InjectedEvidenceItem[] = [
      ...evidence.confirmed,
      ...evidence.likely,
      ...evidence.unverified,
    ];
    items.sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.estimated_tokens - a.estimated_tokens;
    });
    return items;
  }, [evidence]);

  if (allItems.length === 0) {
    return <div className="section-empty">No context files</div>;
  }

  return (
    <div className="context-file-list">
      {allItems.map((item) => {
        const hasSignals = item.signals && item.signals.length > 0;
        const isExpanded = expandedBreakdowns.has(item.path);
        const isLowUtil = lowUtilizationPaths.has(item.path);
        const barColor = EVIDENCE_STATUS_COLORS[item.status];

        return (
          <div key={`${item.status}-${item.path}`} className="context-file-entry">
            <button
              className="context-file-item"
              onClick={() => onOpenFile(item.path)}
            >
              <span className="context-file-left">
                <span
                  className="context-file-dot"
                  style={{ color: barColor }}
                  title={item.status}
                >
                  {STATUS_LABEL[item.status]}
                </span>
                <span className="context-file-info">
                  <span className="context-file-path">
                    {item.path.split("/").slice(-2).join("/")}
                  </span>
                  <span className="context-file-reason">{item.reason}</span>
                </span>
              </span>
              <span className="context-file-right">
                {isLowUtil && (
                  <span className="context-file-low-util">Low util</span>
                )}
                <span className="context-file-tokens">
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
            {item.signals && (
              <SignalBreakdown signals={item.signals} isOpen={isExpanded} />
            )}
          </div>
        );
      })}
    </div>
  );
};
