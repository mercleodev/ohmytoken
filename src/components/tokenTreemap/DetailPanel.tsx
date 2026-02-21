import { CATEGORY_INFO } from './constants';

export type DetailPanelData = {
  isOpen: boolean;
  category: string;
  tokens: number;
  percentage: number;
  cost: number;
  savedCost?: number;
};

type DetailPanelProps = {
  data: DetailPanelData;
  onClose: () => void;
};

export const DetailPanel = ({ data, onClose }: DetailPanelProps) => {
  const categoryInfo = CATEGORY_INFO[data.category];
  if (!categoryInfo) return null;

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-panel-header">
          <h3>{categoryInfo.friendlyName}</h3>
          <button className="detail-panel-close" onClick={onClose}>X</button>
        </div>

        <div className="detail-panel-stats">
          <div className="stat-item">
            <span className="stat-label">Tokens</span>
            <span className="stat-value">{data.tokens.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Share</span>
            <span className="stat-value">{data.percentage.toFixed(1)}%</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Cost</span>
            <span className="stat-value">${data.cost.toFixed(4)}</span>
          </div>
          {data.savedCost && (
            <div className="stat-item good">
              <span className="stat-label">Saved</span>
              <span className="stat-value">-${data.savedCost.toFixed(4)}</span>
            </div>
          )}
        </div>

        <div className="detail-panel-section">
          <h4>What is this?</h4>
          <p>{categoryInfo.whatIsIt}</p>
        </div>

        {data.category === 'CLAUDE.md' && (
          <div className="detail-panel-actions">
            <button
              className="detail-action-btn"
              onClick={() => {
                alert('CLAUDE.md editing will be available in a future update.');
              }}
            >
              Open CLAUDE.md
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
