import type { TreemapCellProps } from './constants';

const MIN_WIDTH_FOR_TEXT = 60;
const MIN_HEIGHT_FOR_TEXT = 40;
const MIN_WIDTH_FOR_DETAILS = 100;
const MIN_HEIGHT_FOR_DETAILS = 60;

export const TreemapCell = (props: TreemapCellProps) => {
  const { x, y, width, height, name, tokens, percentage, color, depth } = props;

  const showText = width > MIN_WIDTH_FOR_TEXT && height > MIN_HEIGHT_FOR_TEXT;
  const showDetails = width > MIN_WIDTH_FOR_DETAILS && height > MIN_HEIGHT_FOR_DETAILS;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color || '#8884d8',
          stroke: '#1a1a2e',
          strokeWidth: depth === 1 ? 3 : 1,
          opacity: 0.9,
          cursor: 'pointer',
        }}
      />
      {showText && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - (showDetails ? 10 : 0)}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontSize: Math.min(14, width / 8),
              fill: '#fff',
              fontWeight: 'bold',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            }}
          >
            {name}
          </text>
          {showDetails && (
            <>
              <text
                x={x + width / 2}
                y={y + height / 2 + 8}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: Math.min(11, width / 10),
                  fill: '#ddd',
                  pointerEvents: 'none',
                }}
              >
                {tokens?.toLocaleString()} tokens
              </text>
              <text
                x={x + width / 2}
                y={y + height / 2 + 22}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: Math.min(10, width / 12),
                  fill: '#aaa',
                  pointerEvents: 'none',
                }}
              >
                {percentage?.toFixed(1)}%
              </text>
            </>
          )}
        </>
      )}
    </g>
  );
};
