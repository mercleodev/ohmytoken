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
      <div className="ctx-ranking__empty">
        No injected files
      </div>
    );
  }

  const maxTokens = files[0]?.cumulativeTokens ?? 1;

  return (
    <div className="ctx-ranking__root">
      {/* Header */}
      <div className="ctx-ranking__header">
        <span className="ctx-ranking__header-rank">#</span>
        <span className="ctx-ranking__header-file">File</span>
        <span className="ctx-ranking__header-cat">Cat</span>
        <span className="ctx-ranking__header-inj">Inj</span>
        <span className="ctx-ranking__header-tokens">Tokens</span>
        <span className="ctx-ranking__header-share">Share</span>
      </div>

      {/* Rows */}
      <div className="file-list ctx-ranking__list">
        {files.map((file, idx) => {
          const barWidth = maxTokens > 0 ? (file.cumulativeTokens / maxTokens) * 100 : 0;
          const color = CATEGORY_COLORS[file.category] ?? '#6b7280';

          return (
            <button
              key={file.path}
              className="file-item ctx-ranking__row"
              onClick={(e) => handleFileClick(file.path, e)}
            >
              {/* # */}
              <span className="ctx-ranking__row-rank">
                {idx + 1}
              </span>

              {/* File name */}
              <span className="file-path">
                {file.path.split('/').slice(-2).join('/')}
              </span>

              {/* Category badge — color is data-driven, kept as inline style */}
              <span
                className="ctx-ranking__badge"
                style={{
                  color,
                  background: `${color}18`,
                }}
              >
                {CATEGORY_SHORT[file.category] ?? file.category}
              </span>

              {/* Injection count */}
              <span className="ctx-ranking__row-inj">
                {file.injectionCount}x
              </span>

              {/* Tokens */}
              <span className="file-tokens ctx-ranking__row-tokens">
                {formatTokens(file.cumulativeTokens)}
              </span>

              {/* Share bar */}
              <span className="ctx-ranking__share-wrap">
                <span className="ctx-ranking__share-track">
                  {/* width and background are data-driven, kept as inline style */}
                  <span
                    className="ctx-ranking__share-fill"
                    style={{
                      width: `${barWidth}%`,
                      background: color,
                    }}
                  />
                </span>
                <span className="ctx-ranking__share-pct">
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
