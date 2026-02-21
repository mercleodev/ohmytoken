import { useState, useCallback } from 'react';
import { formatTokens, CATEGORY_COLORS } from '../scan/shared';
import { FilePreviewPopup } from '../scan/FilePreviewPopup';

type FileRankEntry = {
  path: string;
  category: 'global' | 'project' | 'rules' | 'memory' | 'skill';
  injectionCount: number;
  cumulativeTokens: number;
  percentOfTotal: number;
};

type FileRankingTableProps = {
  files: FileRankEntry[];
};

const CATEGORY_SHORT: Record<string, string> = {
  global: 'GLBL',
  project: 'PROJ',
  rules: 'RULE',
  memory: 'MEM',
  skill: 'SKIL',
};

export const FileRankingTable = ({ files }: FileRankingTableProps) => {
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<DOMRect | null>(null);

  const handleFileClick = useCallback((filePath: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPreviewFile(filePath);
    setPreviewAnchor(rect);
  }, []);

  if (files.length === 0) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', color: '#8e8e93', fontSize: 12 }}>
        No injected files
      </div>
    );
  }

  const maxTokens = files[0]?.cumulativeTokens ?? 1;

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px 6px',
        fontSize: 10,
        fontWeight: 600,
        color: '#8e8e93',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <span style={{ width: 18, textAlign: 'center' }}>#</span>
        <span style={{ flex: 1 }}>File</span>
        <span style={{ width: 36, textAlign: 'center' }}>Cat</span>
        <span style={{ width: 28, textAlign: 'right' }}>Inj</span>
        <span style={{ width: 44, textAlign: 'right' }}>Tokens</span>
        <span style={{ width: 80, textAlign: 'right' }}>Share</span>
      </div>

      {/* Rows */}
      <div className="file-list" style={{ gap: 2 }}>
        {files.map((file, idx) => {
          const barWidth = maxTokens > 0 ? (file.cumulativeTokens / maxTokens) * 100 : 0;
          const color = CATEGORY_COLORS[file.category] ?? '#6b7280';

          return (
            <button
              key={file.path}
              className="file-item"
              onClick={(e) => handleFileClick(file.path, e)}
              style={{ padding: '5px 8px' }}
            >
              {/* # */}
              <span style={{ width: 18, textAlign: 'center', fontSize: 10, color: '#c7c7cc', flexShrink: 0 }}>
                {idx + 1}
              </span>

              {/* File name */}
              <span className="file-path" style={{ flex: 1 }}>
                {file.path.split('/').slice(-2).join('/')}
              </span>

              {/* Category badge */}
              <span style={{
                width: 36,
                textAlign: 'center',
                fontSize: 9,
                fontWeight: 600,
                color,
                background: `${color}18`,
                borderRadius: 4,
                padding: '1px 4px',
                flexShrink: 0,
              }}>
                {CATEGORY_SHORT[file.category] ?? file.category}
              </span>

              {/* Injection count */}
              <span style={{ width: 28, textAlign: 'right', fontSize: 11, color: '#8e8e93', flexShrink: 0 }}>
                {file.injectionCount}x
              </span>

              {/* Tokens */}
              <span className="file-tokens" style={{ width: 44, textAlign: 'right' }}>
                {formatTokens(file.cumulativeTokens)}
              </span>

              {/* Share bar */}
              <span style={{ width: 80, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(0,0,0,0.06)',
                  overflow: 'hidden',
                }}>
                  <span style={{
                    display: 'block',
                    height: '100%',
                    width: `${barWidth}%`,
                    borderRadius: 2,
                    background: color,
                    transition: 'width 0.3s ease',
                  }} />
                </span>
                <span style={{ fontSize: 10, color: '#8e8e93', minWidth: 28, textAlign: 'right' }}>
                  {file.percentOfTotal.toFixed(1)}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* File Preview Popup */}
      {previewFile && (
        <FilePreviewPopup
          filePath={previewFile}
          anchorRect={previewAnchor}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};
