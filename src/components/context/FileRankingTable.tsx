import { useState, useCallback } from 'react';
import { formatTokens, CATEGORY_COLORS } from '../scan/shared';
import { FilePreviewPopup } from '../scan/FilePreviewPopup';
import './context.css';

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
      <div className="file-ranking-empty">
        No injected files
      </div>
    );
  }

  const maxTokens = files[0]?.cumulativeTokens ?? 1;

  return (
    <div className="file-ranking-table">
      {/* Header */}
      <div className="file-ranking-header">
        <span className="file-ranking-col-rank">#</span>
        <span className="file-ranking-col-file">File</span>
        <span className="file-ranking-col-cat">Cat</span>
        <span className="file-ranking-col-inj">Inj</span>
        <span className="file-ranking-col-tokens">Tokens</span>
        <span className="file-ranking-col-share">Share</span>
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
              <span className="file-ranking-rank">
                {idx + 1}
              </span>

              {/* File name */}
              <span className="file-path" style={{ flex: 1 }}>
                {file.path.split('/').slice(-2).join('/')}
              </span>

              {/* Category badge */}
              <span
                className="file-ranking-cat-badge"
                style={{
                  color,
                  background: `${color}18`,
                }}
              >
                {CATEGORY_SHORT[file.category] ?? file.category}
              </span>

              {/* Injection count */}
              <span className="file-ranking-inj-count">
                {file.injectionCount}x
              </span>

              {/* Tokens */}
              <span className="file-tokens" style={{ width: 44, textAlign: 'right' }}>
                {formatTokens(file.cumulativeTokens)}
              </span>

              {/* Share bar */}
              <span className="file-ranking-share">
                <span className="file-ranking-share-track">
                  <span
                    className="file-ranking-share-fill"
                    style={{
                      width: `${barWidth}%`,
                      background: color,
                    }}
                  />
                </span>
                <span className="file-ranking-share-pct">
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
