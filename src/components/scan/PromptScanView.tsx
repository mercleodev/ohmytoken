import { useState, useEffect, useCallback, useRef } from "react";
import { PromptTimeline } from "./PromptTimeline";
import { ProxyStatusBar } from "./ProxyStatusBar";
import { ContextWindowGauge } from "./ContextWindowGauge";
import { FilePreviewPopup } from "./FilePreviewPopup";
import { ScanDetailPanel } from "./ScanDetailPanel";
import {
  formatCost,
  formatTokens,
  formatTimeAgo,
  getModelShort,
  getModelColor,
} from "./shared";
import type { PromptScan, UsageLogEntry } from "../../types";
import "./scan.css";

type PromptScanViewProps = {
  onBack: () => void;
  embedded?: boolean; // true when used inside Dashboard → hides header
};

type MessageItem = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

export const PromptScanView = ({
  onBack,
  embedded = false,
}: PromptScanViewProps) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [selectedScan, setSelectedScan] = useState<PromptScan | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<UsageLogEntry | null>(null);

  // File preview
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<DOMRect | null>(null);

  const feedRef = useRef<HTMLDivElement>(null);

  // 1. Initial load: session ID → load scans for that session
  useEffect(() => {
    const init = async () => {
      try {
        const sid = await window.api.getCurrentSessionId();
        setSessionId(sid);

        const scans = await window.api.getSessionScans(sid);
        if (!scans || scans.length === 0) {
          setMessages([]);
          return;
        }

        // Sort chronologically (oldest first)
        const sorted = [...scans].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        const items: MessageItem[] = await Promise.all(
          sorted.map(async (scan) => {
            const detail = await window.api.getPromptScanDetail(
              scan.request_id,
            );
            return {
              scan,
              usage: detail?.usage ?? null,
            };
          }),
        );

        setMessages(items);
      } catch (err) {
        console.error("Failed to init CT Scan:", err);
        setInitError("Failed to load scan data. Check proxy status.");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // 2. Real-time: append new scans to the list as they arrive
  useEffect(() => {
    const cleanup = window.api.onNewPromptScan(({ scan, usage }) => {
      const newItem: MessageItem = {
        scan,
        usage,
      };
      setMessages((prev) => [...prev, newItem]);

      // Auto-scroll
      requestAnimationFrame(() => {
        feedRef.current?.scrollTo({
          top: feedRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    });
    return cleanup;
  }, []);

  const handleSelectScan = useCallback(
    (scan: PromptScan, usage: UsageLogEntry | null) => {
      setSelectedScan(scan);
      setSelectedUsage(usage);
    },
    [],
  );

  const handleMessageClick = useCallback(async (item: MessageItem) => {
    try {
      // Use existing usage if available, otherwise fetch
      if (item.usage) {
        setSelectedScan(item.scan);
        setSelectedUsage(item.usage);
      } else {
        const detail = await window.api.getPromptScanDetail(
          item.scan.request_id,
        );
        if (detail) {
          setSelectedScan(detail.scan);
          setSelectedUsage(detail.usage ?? null);
        }
      }
    } catch (err) {
      console.error("Failed to load scan detail:", err);
    }
  }, []);

  const handleFileClick = useCallback(
    (filePath: string, e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPreviewFile(filePath);
      setPreviewAnchor(rect);
    },
    [],
  );

  // Calculate session summary
  const sessionCost = messages.reduce(
    (sum, m) => sum + (m.usage?.cost_usd ?? 0),
    0,
  );
  const latest = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <div className="scan-view">
      {/* Header - hidden in embedded mode */}
      {!embedded && (
        <div className="scan-view__header">
          <h2 className="scan-view__title">
            Prompt CT Scan
          </h2>
          <button
            onClick={onBack}
            className="scan-view__back-btn"
          >
            Back
          </button>
        </div>
      )}

      {/* Proxy Status */}
      <ProxyStatusBar />

      {/* Context Window Gauge — based on latest message */}
      {latest &&
        (() => {
          const ctx = latest.scan.context_estimate;
          return (
            <ContextWindowGauge
              totalTokens={ctx.total_tokens}
              model={latest.scan.model}
              messagesTokens={ctx.messages_tokens}
              systemTokens={ctx.system_tokens}
              toolsTokens={ctx.tools_definition_tokens}
              messagesBreakdown={ctx.messages_tokens_breakdown}
            />
          );
        })()}

      {/* Session Info Bar */}
      {sessionId && (
        <div className="scan-view__session-bar">
          <span className="scan-view__session-label">
            Session:{" "}
            <span className="scan-view__session-id">
              {sessionId.slice(0, 8)}...{sessionId.slice(-4)}
            </span>
          </span>
          <span className="scan-view__session-meta">
            {messages.length} messages | {formatCost(sessionCost)}
          </span>
        </div>
      )}

      {/* Message Feed */}
      <div className="scan-view__feed-section">
        <div className="scan-view__feed-title">
          Messages
        </div>
        {loading ? (
          <div className="scan-view__feed-loading">
            Loading...
          </div>
        ) : initError ? (
          <div className="scan-view__feed-error">
            {initError}
          </div>
        ) : messages.length === 0 ? (
          <div className="scan-view__feed-empty">
            No messages yet. Make API requests through the proxy to see CT scan
            data.
          </div>
        ) : (
          <div ref={feedRef} className="scan-view__feed-list">
            {messages.map((item) => {
              const { scan, usage } = item;
              const ctx = scan.context_estimate;
              const total = ctx.total_tokens || 1;
              const isSelected = selectedScan?.request_id === scan.request_id;

              return (
                <div
                  key={scan.request_id}
                  className={`scan-view__message${isSelected ? ' scan-view__message--selected' : ''}`}
                  style={{ borderLeft: `3px solid ${getModelColor(scan.model)}` }}
                  onClick={() => handleMessageClick(item)}
                >
                  {/* Prompt text + time */}
                  <div className="scan-view__message-row">
                    <div className="scan-view__message-prompt">
                      {scan.user_prompt || "(system)"}
                    </div>
                    <div className="scan-view__message-time">
                      {formatTimeAgo(scan.timestamp)}
                    </div>
                  </div>

                  {/* Model + cost + context ratio bar */}
                  <div className="scan-view__message-meta">
                    <span
                      className="scan-view__message-model"
                      style={{ color: getModelColor(scan.model) }}
                    >
                      {getModelShort(scan.model)}
                    </span>
                    <span className="scan-view__message-cost">
                      {formatCost(usage?.cost_usd ?? 0)}
                    </span>
                    <span className="scan-view__message-tokens">
                      {formatTokens(ctx.total_tokens)}
                    </span>

                    {/* Context ratio mini-bar (6-color) */}
                    {(() => {
                      const bd = ctx.messages_tokens_breakdown;
                      const hasBd =
                        bd &&
                        (bd.user_text_tokens > 0 ||
                          bd.assistant_tokens > 0 ||
                          bd.tool_result_tokens > 0);
                      return (
                        <div className="scan-view__ratio-bar">
                          <div
                            style={{
                              width: `${(ctx.system_tokens / total) * 100}%`,
                              background: "#8b5cf6",
                            }}
                          />
                          {hasBd ? (
                            <>
                              <div
                                style={{
                                  width: `${(bd.user_text_tokens / total) * 100}%`,
                                  background: "#3b82f6",
                                }}
                              />
                              <div
                                style={{
                                  width: `${(bd.assistant_tokens / total) * 100}%`,
                                  background: "#60a5fa",
                                }}
                              />
                              <div
                                style={{
                                  width: `${(bd.tool_result_tokens / total) * 100}%`,
                                  background: "#06b6d4",
                                }}
                              />
                            </>
                          ) : (
                            <div
                              style={{
                                width: `${(ctx.messages_tokens / total) * 100}%`,
                                background: "#3b82f6",
                              }}
                            />
                          )}
                          <div
                            style={{
                              width: `${(ctx.tools_definition_tokens / total) * 100}%`,
                              background: "#f59e0b",
                            }}
                          />
                        </div>
                      );
                    })()}

                    <span className="scan-view__message-ratio-label">
                      S{((ctx.system_tokens / total) * 100).toFixed(0)}% M
                      {((ctx.messages_tokens / total) * 100).toFixed(0)}% T
                      {((ctx.tools_definition_tokens / total) * 100).toFixed(0)}
                      %
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Timeline Chart */}
      <PromptTimeline entries={messages} onSelectScan={handleSelectScan} />

      {/* Selected Scan Detail */}
      {selectedScan && (
        <div className="scan-view__detail-section">
          <ScanDetailPanel
            scan={selectedScan}
            usage={selectedUsage}
            onFileClick={handleFileClick}
          />
        </div>
      )}

      {/* File Preview Popup */}
      {previewFile && (
        <FilePreviewPopup
          filePath={previewFile}
          anchorRect={previewAnchor}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};
