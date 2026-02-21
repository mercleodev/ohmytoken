import { useState, useCallback } from 'react';
import { usePolling } from '../../hooks';

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
    <div style={{
      padding: '10px 12px',
      background: status.running
        ? 'rgba(16, 185, 129, 0.08)'
        : 'rgba(255, 255, 255, 0.03)',
      border: `1px solid ${status.running ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 10,
      marginBottom: 12,
    }}>
      {/* Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: status.running ? 8 : 0 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: status.running ? '#10b981' : '#f59e0b',
          boxShadow: status.running ? '0 0 6px #10b981' : 'none',
        }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: status.running ? '#10b981' : '#f59e0b' }}>
          {status.running ? `Proxy :${status.port}` : 'Proxy starting...'}
        </span>
        {status.running && (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            {status.requests_total} reqs
            {status.errors_total > 0 && ` / ${status.errors_total} err`}
          </span>
        )}
      </div>

      {/* Copy command */}
      {status.running && (
        <div
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          <code style={{
            flex: 1,
            fontSize: 11,
            color: '#a5b4fc',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            ANTHROPIC_BASE_URL=http://localhost:{status.port || 8780} claude
          </code>
          <span style={{
            fontSize: 10,
            color: copied ? '#10b981' : '#64748b',
            whiteSpace: 'nowrap',
            fontWeight: 500,
          }}>
            {copied ? 'Copied!' : 'Copy'}
          </span>
        </div>
      )}
    </div>
  );
};
