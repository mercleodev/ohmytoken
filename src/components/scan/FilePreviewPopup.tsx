import { useState, useEffect, useRef } from 'react';
import { useClickOutside } from '../../hooks';
import './scan.css';

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

  // bottom position is dynamic — depends on anchorRect at runtime
  const bottomOffset = anchorRect
    ? Math.max(window.innerHeight - anchorRect.top + 8, 60)
    : 60;

  const shortName = filePath.split('/').slice(-2).join('/');

  return (
    <div
      ref={popupRef}
      className="scan-popup"
      style={{ bottom: bottomOffset }}
    >
      {/* Header */}
      <div className="scan-popup__header">
        <div className="scan-popup__filename">
          {shortName}
        </div>
        <button
          onClick={onClose}
          className="scan-popup__close-btn"
        >
          ESC
        </button>
      </div>

      {/* Full path */}
      <div className="scan-popup__filepath">
        {filePath}
      </div>

      {/* Content */}
      <div className="scan-popup__content">
        {error ? (
          <div className="scan-popup__error">{error}</div>
        ) : content === null ? (
          <div className="scan-popup__loading">Loading...</div>
        ) : (
          <pre className="scan-popup__pre">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};
