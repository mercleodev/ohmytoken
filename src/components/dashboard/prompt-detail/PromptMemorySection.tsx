import { useState, useEffect } from 'react';
import type { MemoryStatus, MemoryFile } from '../../../types/electron';

const TYPE_COLORS: Record<string, string> = {
  user: '#007AFF',
  feedback: '#FF9500',
  project: '#34C759',
  reference: '#AF52DE',
  unknown: '#8E8E93',
};

const TYPE_LABELS: Record<string, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  unknown: 'Other',
};

const MemoryFileRow = ({ file, isExpanded, onToggle }: {
  file: MemoryFile;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const typeColor = TYPE_COLORS[file.type] ?? TYPE_COLORS.unknown;
  const typeLabel = TYPE_LABELS[file.type] ?? file.type;

  return (
    <div className="memory-file-item">
      <div className="memory-file-header" onClick={onToggle}>
        <span className="memory-file-type" style={{ color: typeColor }}>{typeLabel}</span>
        <span className="memory-file-name">{file.name}</span>
        <span className="memory-file-lines">{file.lineCount}L</span>
        <span className={`memory-file-chevron ${isExpanded ? 'expanded' : ''}`}>›</span>
      </div>
      {file.description && (
        <div className="memory-file-desc">{file.description}</div>
      )}
      <div
        className={`collapsible ${isExpanded ? 'open' : ''}`}
        aria-hidden={!isExpanded}
      >
        <div className="collapsible-inner">
          <pre className="memory-file-content">{file.content}</pre>
        </div>
      </div>
    </div>
  );
};

type PromptMemorySectionProps = {
  projectPath: string | undefined;
  provider: string | undefined;
  expanded: Set<string>;
  onToggle: (id: string) => void;
};

const memoryLabel = (provider: string | undefined): string => {
  const p = (provider ?? 'claude').toLowerCase();
  if (p === 'codex') return 'Codex Memory';
  return 'Claude Memory';
};

const isProviderWithoutProjectScope = (provider: string | undefined): boolean => {
  const p = (provider ?? 'claude').toLowerCase();
  return p === 'codex';
};

export const PromptMemorySection = ({ projectPath, provider, expanded, onToggle }: PromptMemorySectionProps) => {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const isOpen = expanded.has('memory');
  const label = memoryLabel(provider);
  const needsProjectPath = !isProviderWithoutProjectScope(provider);

  useEffect(() => {
    if (needsProjectPath && !projectPath) {
      setLoading(false);
      return;
    }
    window.api.getMemoryStatus(projectPath, provider)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [projectPath, provider, needsProjectPath]);

  // Claude needs project_path; Codex reads from global ~/.codex/memories
  if (needsProjectPath && !projectPath) {
    return (
      <div className="detail-section">
        <button
          className="detail-section-header"
          onClick={() => onToggle('memory')}
          aria-expanded={isOpen}
        >
          <span>{label}</span>
          <span className="detail-section-header-right">
            <span className={`detail-section-chevron ${isOpen ? 'expanded' : ''}`}>›</span>
          </span>
        </button>
        <div className={`collapsible ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
          <div className="collapsible-inner">
            <div className="detail-section-body">
              <div className="prompt-memory-notice">
                Project unknown — memory not available for this prompt
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const fileCount = status?.files.length ?? 0;
  const title = loading ? `${label} (...)` : `${label} (${fileCount})`;

  return (
    <div className="detail-section">
      <button
        className="detail-section-header"
        onClick={() => onToggle('memory')}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <span className="detail-section-header-right">
          <span className={`detail-section-chevron ${isOpen ? 'expanded' : ''}`}>›</span>
        </span>
      </button>
      <div className={`collapsible ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
        <div className="collapsible-inner">
          <div className="detail-section-body">
            <div className="prompt-memory-disclaimer">
              Showing current memory for this project (may differ from when this prompt ran)
            </div>
            {loading && <div className="prompt-memory-notice">Loading...</div>}
            {!loading && !status && (
              <div className="prompt-memory-notice">No memory data for this project</div>
            )}
            {!loading && status && status.files.length === 0 && (
              <div className="prompt-memory-notice">No memory files</div>
            )}
            {!loading && status && status.files.length > 0 && (
              <div className="memory-file-list">
                {status.files.map((file) => (
                  <MemoryFileRow
                    key={file.fileName}
                    file={file}
                    isExpanded={expandedFile === file.fileName}
                    onToggle={() => setExpandedFile(
                      expandedFile === file.fileName ? null : file.fileName,
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
