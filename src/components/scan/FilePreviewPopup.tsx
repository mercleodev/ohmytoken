import { useState, useEffect, useRef } from 'react';
import { useClickOutside } from '../../hooks';

type FilePreviewPopupProps = {
  filePath: string;
  anchorRect: DOMRect | null;
  onClose: () => void;
};

export const FilePreviewPopup = ({ filePath, anchorRect, onClose }: FilePreviewPopupProps) => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.api.readFileContent(filePath);
        if (result.error) {
          setError(result.error);
        } else {
          setContent(result.content);
        }
      } catch (err) {
        setError(String(err));
      }
    };
    load();
  }, [filePath]);

  // Close on outside click or ESC
  useClickOutside(popupRef, onClose);

  const popupStyle: React.CSSProperties = {
    position: 'fixed',
    left: 16,
    right: 16,
    bottom: anchorRect ? Math.max(window.innerHeight - anchorRect.top + 8, 60) : 60,
    maxHeight: '60vh',
    background: '#0f172a',
    border: '1px solid rgba(139, 92, 246, 0.4)',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const shortName = filePath.split('/').slice(-2).join('/');

  return (
    <div ref={popupRef} style={popupStyle}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(139, 92, 246, 0.1)',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#c4b5fd' }}>
          {shortName}
        </div>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'rgba(255,255,255,0.1)',
            color: '#94a3b8',
            borderRadius: 4,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ESC
        </button>
      </div>

      {/* Full path */}
      <div style={{
        padding: '6px 14px',
        fontSize: 10,
        color: '#64748b',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
      }}>
        {filePath}
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 14px',
      }}>
        {error ? (
          <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>
        ) : content === null ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading...</div>
        ) : (
          <pre style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#e2e8f0',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          }}>
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};
