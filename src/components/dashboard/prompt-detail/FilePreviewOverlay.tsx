import { useState, useEffect, useRef, Suspense } from "react";
import { motion } from "framer-motion";
import { getLanguage, SyntaxHighlighter, syntaxThemePromise } from "./constants";

export const FilePreviewOverlay = ({
  filePath,
  onClose,
}: {
  filePath: string;
  onClose: () => void;
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syntaxTheme, setSyntaxTheme] = useState<Record<
    string,
    React.CSSProperties
  > | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.api.readFileContent(filePath);
        if (result.error) setError(result.error);
        else setContent(result.content);
      } catch (err) {
        setError(String(err));
      }
    };
    load();
  }, [filePath]);

  useEffect(() => {
    syntaxThemePromise.then(setSyntaxTheme);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const shortName = filePath.split("/").slice(-2).join("/");
  const language = getLanguage(filePath);

  return (
    <motion.div
      className="file-preview-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        className="file-preview-panel"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        ref={overlayRef}
      >
        <div className="file-preview-header">
          <span className="file-preview-name">{shortName}</span>
          <span className="file-preview-lang">{language}</span>
          <button className="file-preview-close" onClick={onClose}>
            ESC
          </button>
        </div>
        <div className="file-preview-path">{filePath}</div>
        <div className="file-preview-body">
          {error ? (
            <div style={{ color: "#ff3b30", fontSize: 13 }}>{error}</div>
          ) : content === null ? (
            <div
              style={{ display: "flex", justifyContent: "center", padding: 20 }}
            >
              <div className="spinner" />
            </div>
          ) : syntaxTheme ? (
            <Suspense
              fallback={<pre className="file-preview-content">{content}</pre>}
            >
              <SyntaxHighlighter
                language={language}
                style={syntaxTheme}
                showLineNumbers
                customStyle={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.6,
                  borderRadius: 0,
                  background: "transparent",
                }}
                lineNumberStyle={{
                  minWidth: "2.5em",
                  paddingRight: "1em",
                  color: "#636d83",
                  userSelect: "none",
                }}
              >
                {content}
              </SyntaxHighlighter>
            </Suspense>
          ) : (
            <pre className="file-preview-content">{content}</pre>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
