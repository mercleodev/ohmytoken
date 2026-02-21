import type { ContextLogs } from '../../types';

type ContextLogsPanelProps = {
  contextLogs: ContextLogs;
  showContextLogs: boolean;
  onToggle: () => void;
};

export const ContextLogsPanel = ({
  contextLogs,
  showContextLogs,
  onToggle,
}: ContextLogsPanelProps) => {
  return (
    <div className="context-logs-section" style={{ marginTop: '20px' }}>
      <div
        className="context-logs-header"
        onClick={onToggle}
      >
        <h3>Referenced Context</h3>
        <span className="context-logs-toggle">
          {showContextLogs ? '\u25BC' : '\u25B6'}
        </span>
        <span className="context-logs-summary">
          Auto-injected: {contextLogs.autoInjected.length} |
          Files: {contextLogs.readFiles.length} |
          Searches: {contextLogs.globSearches.length + contextLogs.grepSearches.length}
        </span>
      </div>

      {showContextLogs && (
        <div className="context-logs-content">
          <div className="context-log-group">
            <div className="context-log-title">Built-in Skills (System)</div>
            <ul>
              <li className="context-log-item builtin-skill">
                keybindings-help
              </li>
            </ul>
          </div>

          {contextLogs.autoInjected.length > 0 && (
            <div className="context-log-group">
              <div className="context-log-title">Auto-injected (User Config)</div>
              <ul>
                {contextLogs.autoInjected.map((file, idx) => (
                  <li key={idx} className="context-log-item auto-injected">
                    {file.replace(/^\/Users\/[^/]+/, '~')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contextLogs.readFiles.length > 0 && (
            <div className="context-log-group">
              <div className="context-log-title">Read Files</div>
              <ul>
                {contextLogs.readFiles.map((file, idx) => (
                  <li key={idx} className="context-log-item read-file">
                    {file.replace(/^\/Users\/[^/]+/, '~')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contextLogs.globSearches.length > 0 && (
            <div className="context-log-group">
              <div className="context-log-title">File Search (Glob)</div>
              <ul>
                {contextLogs.globSearches.map((search, idx) => (
                  <li key={idx} className="context-log-item glob-search">
                    <span className="search-pattern">{search.pattern}</span>
                    <span className="search-path">in {search.searchPath.replace(/^\/Users\/[^/]+/, '~')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contextLogs.grepSearches.length > 0 && (
            <div className="context-log-group">
              <div className="context-log-title">Content Search (Grep)</div>
              <ul>
                {contextLogs.grepSearches.map((search, idx) => (
                  <li key={idx} className="context-log-item grep-search">
                    <span className="search-pattern">{search.pattern}</span>
                    <span className="search-path">in {search.searchPath.replace(/^\/Users\/[^/]+/, '~')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contextLogs.sessionId && (
            <div className="context-log-session">
              Session: {contextLogs.sessionId.slice(0, 8)}...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
