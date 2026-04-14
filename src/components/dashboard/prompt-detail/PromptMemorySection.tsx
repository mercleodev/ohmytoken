import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            style={{ overflow: 'hidden' }}
          >
            <pre className="memory-file-content">{file.content}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

type PromptMemorySectionProps = {
  projectPath: string | undefined;
  expanded: Set<string>;
  onToggle: (id: string) => void;
};

export const PromptMemorySection = ({ projectPath, expanded, onToggle }: PromptMemorySectionProps) => {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const isOpen = expanded.has('memory');

  useEffect(() => {
    if (!projectPath) {
      setLoading(false);
      return;
    }
    window.api.getMemoryStatus(projectPath)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [projectPath]);

  // No project_path → show placeholder
  if (!projectPath) {
    return (
      <div className="detail-section">
        <button className="detail-section-header" onClick={() => onToggle('memory')}>
          <span>Claude Memory</span>
          <span className="detail-section-header-right">
            <span className={`detail-section-chevron ${isOpen ? 'expanded' : ''}`}>›</span>
          </span>
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="detail-section-body">
                <div className="prompt-memory-notice">
                  Project unknown — memory not available for this prompt
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const fileCount = status?.files.length ?? 0;
  const title = loading ? 'Claude Memory (...)' : `Claude Memory (${fileCount})`;

  return (
    <div className="detail-section">
      <button className="detail-section-header" onClick={() => onToggle('memory')}>
        <span>{title}</span>
        <span className="detail-section-header-right">
          <span className={`detail-section-chevron ${isOpen ? 'expanded' : ''}`}>›</span>
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            style={{ overflow: 'hidden' }}
          >
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
