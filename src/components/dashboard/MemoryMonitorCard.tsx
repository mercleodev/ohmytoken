import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { MemoryStatus, MemoryFile } from '../../types/electron';

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

const MemoryFileItem = ({ file, isExpanded, onToggle }: {
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
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <pre className="memory-file-content">{file.content}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const MemoryMonitorCard = () => {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.api.getMemoryStatus();
        setStatus(result);
      } catch {
        setStatus(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading || !status) return null;

  const pct = Math.round((status.indexLineCount / status.indexMaxLines) * 100);
  const isWarning = pct >= 80;
  const isCritical = pct >= 95;
  const barColor = isCritical ? '#FF3B30' : isWarning ? '#FF9500' : '#34C759';

  return (
    <div className="memory-card">
      <div className="memory-header" onClick={() => setExpanded(!expanded)}>
        <span className="memory-title">Claude Memory</span>
        <span className="memory-line-count" style={{ color: barColor }}>
          {status.indexLineCount} / {status.indexMaxLines}
        </span>
        <span className={`memory-chevron ${expanded ? 'expanded' : ''}`}>›</span>
      </div>

      <div className="memory-bar-track">
        <div
          className="memory-bar-fill"
          style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
        />
      </div>

      {isCritical && (
        <div className="memory-warning memory-warning--critical">
          Memory index is at {pct}% — lines beyond 200 will be truncated
        </div>
      )}
      {isWarning && !isCritical && (
        <div className="memory-warning">
          Memory index approaching limit ({pct}%) — consider cleaning up old entries
        </div>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="memory-stats">
              <span>{status.files.length} memory files</span>
              <span className="memory-stats-sep">·</span>
              <span>{status.files.reduce((s, f) => s + f.lineCount, 0)} total lines</span>
            </div>

            <div className="memory-file-list">
              {status.files.map((file) => (
                <MemoryFileItem
                  key={file.fileName}
                  file={file}
                  isExpanded={expandedFile === file.fileName}
                  onToggle={() => setExpandedFile(
                    expandedFile === file.fileName ? null : file.fileName,
                  )}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
