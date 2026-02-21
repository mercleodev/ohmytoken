import type { CacheUsageItem } from '../../types';
import type { TreemapTooltipProps } from './constants';

export const TreemapTooltip = ({ active, payload }: TreemapTooltipProps) => {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;

  return (
    <div className="treemap-tooltip">
      <div className="tooltip-header">{data.name}</div>
      <div className="tooltip-row">
        <span className="label">Tokens:</span>
        <span className="value">{data.tokens?.toLocaleString()}</span>
      </div>
      <div className="tooltip-row">
        <span className="label">Percentage:</span>
        <span className="value">{data.percentage?.toFixed(2)}%</span>
      </div>
      {data.name === 'CLAUDE.md' && (
        <div className="tooltip-warning">
          Warning: Takes up most of the context
        </div>
      )}
      {data.name === 'Cache Read' && (
        <div className="tooltip-good">
          90% cost savings from cache!
        </div>
      )}
      {data.cacheDetails && data.cacheDetails.length > 0 && (
        <div className="tooltip-cache-details">
          <div className="cache-details-header">Recent cache usage:</div>
          {data.cacheDetails.slice(0, 3).map((item: CacheUsageItem, idx: number) => (
            <div key={idx} className="cache-detail-item">
              <span className="cache-prompt">{item.prompt || '(request)'}</span>
              <span className="cache-tokens">
                {item.cacheRead > 0 && `Read: ${item.cacheRead.toLocaleString()}`}
                {item.cacheCreation > 0 && ` Created: ${item.cacheCreation.toLocaleString()}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {data.claudeMdPreview && (
        <div className="tooltip-claudemd-preview">
          <div className="claudemd-preview-header">Cached CLAUDE.md:</div>
          <div className="claudemd-preview-content">{data.claudeMdPreview}</div>
        </div>
      )}
    </div>
  );
};
