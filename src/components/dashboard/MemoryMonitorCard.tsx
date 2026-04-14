import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { MemoryStatus, MemoryFile, ProjectMemorySummary } from '../../types/electron';

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

const ProjectMemoryChip = ({ project, onExpand }: {
  project: ProjectMemorySummary;
  onExpand: () => void;
}) => {
  const pct = Math.round((project.indexLineCount / project.indexMaxLines) * 100);
  const barColor = pct >= 95 ? '#FF3B30' : pct >= 80 ? '#FF9500' : '#34C759';

  return (
    <div className="memory-project-chip" onClick={onExpand}>
      <div className="memory-project-chip-header">
        <span className="memory-project-chip-name">{project.projectName}</span>
        <span className="memory-project-chip-count" style={{ color: barColor }}>
          {project.indexLineCount}/{project.indexMaxLines}
        </span>
      </div>
      <div className="memory-bar-track" style={{ margin: '4px 0 0' }}>
        <div
          className="memory-bar-fill"
          style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
        />
      </div>
      <div className="memory-project-chip-meta">
        {project.fileCount} files · {project.totalLines} lines
      </div>
    </div>
  );
};

const ProjectMemoryDetail = ({ projectPath, onClose }: {
  projectPath: string;
  onClose: () => void;
}) => {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.getMemoryStatus(projectPath)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [projectPath]);

  if (loading) {
    return <div className="memory-project-detail-loading">Loading...</div>;
  }

  if (!status) {
    return <div className="memory-project-detail-loading">No memory data</div>;
  }

  return (
    <div className="memory-project-detail">
      <div className="memory-project-detail-header">
        <span className="memory-project-detail-back" onClick={onClose}>←</span>
        <span className="memory-project-detail-title">
          {projectPath.split('/').filter(Boolean).pop()}
        </span>
      </div>
      <div className="memory-project-detail-banner">
        Viewing memory for a different project
      </div>
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
    </div>
  );
};

export const MemoryMonitorCard = () => {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Multi-project state
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [allProjects, setAllProjects] = useState<ProjectMemorySummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [result, config] = await Promise.all([
          window.api.getMemoryStatus(),
          window.api.getConfig(),
        ]);
        setStatus(result);

        const enabled = config?.settings?.showAllProjectsMemory ?? false;
        setShowAllProjects(enabled);

        if (enabled) {
          const summary = await window.api.getAllProjectsMemorySummary();
          if (summary?.projects) {
            setAllProjects(summary.projects.filter((p) => !p.isCurrentProject));
          }
        }
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

  // Viewing a non-current project's detail
  if (selectedProject) {
    return (
      <div className="memory-card">
        <ProjectMemoryDetail
          projectPath={selectedProject}
          onClose={() => setSelectedProject(null)}
        />
      </div>
    );
  }

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

            {/* Other projects (gated by setting) */}
            {showAllProjects && allProjects.length > 0 && (
              <div className="memory-other-projects">
                <div className="memory-other-projects-label">Other Projects</div>
                <div className="memory-project-chips">
                  {allProjects.map((p) => (
                    <ProjectMemoryChip
                      key={p.encodedDir}
                      project={p}
                      onExpand={() => setSelectedProject(p.projectPath)}
                    />
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
