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

  const shortName = filePath.split('/').slice(-2).join('/');

  return (
    <div
      ref={popupRef}
      className="file-preview-popup"
      style={{
        bottom: anchorRect ? Math.max(window.innerHeight - anchorRect.top + 8, 60) : 60,
      }}
    >
      {/* Header */}
      <div className="file-preview-popup-header">
        <div className="file-preview-popup-name">
          {shortName}
        </div>
        <button onClick={onClose} className="file-preview-popup-close">
          ESC
        </button>
      </div>

      {/* Full path */}
      <div className="file-preview-popup-path">
        {filePath}
      </div>

      {/* Content */}
      <div className="file-preview-popup-body">
        {error ? (
          <div className="file-preview-popup-error">{error}</div>
        ) : content === null ? (
          <div className="file-preview-popup-loading">Loading...</div>
        ) : (
          <pre className="file-preview-popup-content">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
};
