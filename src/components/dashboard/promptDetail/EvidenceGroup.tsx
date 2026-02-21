import { formatTokens } from "../../scan/shared";
import type { EvidenceStatus, InjectedEvidenceItem } from "./constants";

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
  if (items.length === 0) return null;
  return (
    <div className="injected-evidence-group">
      <div className="injected-evidence-group-title">
        <span className={`injected-evidence-dot ${status}`} />
        <span>{title}</span>
      </div>
      <div className="injected-evidence-list">
        {items.map((item) => (
          <button
            key={`${status}-${item.path}`}
            className="injected-evidence-item"
            onClick={() => onOpenFile(item.path)}
          >
            <span className="injected-evidence-item-main">
              <span className="injected-evidence-item-path">
                {item.path.split("/").slice(-2).join("/")}
              </span>
              <span className="injected-evidence-item-reason">
                {item.reason}
              </span>
            </span>
            <span className="injected-evidence-item-tokens">
              {formatTokens(item.estimated_tokens)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
