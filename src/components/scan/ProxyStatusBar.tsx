import { useState, useCallback } from 'react';
import { usePolling } from '../../hooks';
import './scan.css';

type ProxyStatusData = {
  running: boolean;
  port: number | null;
  requests_total: number;
  errors_total: number;
};

export const ProxyStatusBar = () => {
  const [status, setStatus] = useState<ProxyStatusData>({
    running: false, port: null, requests_total: 0, errors_total: 0,
  });
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.api.getProxyStatus();
      setStatus(s);
    } catch {
      // ignore
    }
  }, []);

  usePolling(refreshStatus, 3000);

  const handleCopy = () => {
    const cmd = `ANTHROPIC_BASE_URL=http://localhost:${status.port || 8780} claude`;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="scan-proxy"
      style={{
        background: status.running
          ? 'rgba(16, 185, 129, 0.08)'
          : 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${status.running ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {/* Status indicator */}
      <div
        className="scan-proxy__status-row"
        style={{ marginBottom: status.running ? 8 : 0 }}
      >
        <div
          className="scan-proxy__indicator"
          style={{
            background: status.running ? '#10b981' : '#f59e0b',
            boxShadow: status.running ? '0 0 6px #10b981' : 'none',
          }}
        />
        <span
          className="scan-proxy__status-text"
          style={{ color: status.running ? '#10b981' : '#f59e0b' }}
        >
          {status.running ? `Proxy :${status.port}` : 'Proxy starting...'}
        </span>
        {status.running && (
          <span className="scan-proxy__req-count">
            {status.requests_total} reqs
            {status.errors_total > 0 && ` / ${status.errors_total} err`}
          </span>
        )}
      </div>

      {/* Copy command */}
      {status.running && (
        <div
          onClick={handleCopy}
          className="scan-proxy__copy-row"
        >
          <code className="scan-proxy__code">
            ANTHROPIC_BASE_URL=http://localhost:{status.port || 8780} claude
          </code>
          <span
            className="scan-proxy__copy-label"
            style={{ color: copied ? '#10b981' : '#64748b' }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </span>
        </div>
      )}
    </div>
  );
};
