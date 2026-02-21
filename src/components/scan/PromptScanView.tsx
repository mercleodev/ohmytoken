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
import type { PromptScanData, UsageData } from "./PromptTimeline";
import './scan.css';

type PromptScanViewProps = {
  onBack: () => void;
  embedded?: boolean; // true when used inside Dashboard → hides header
};

type MessageItem = {
  scan: PromptScanData;
  usage: UsageData | null;
};

export const PromptScanView = ({
  onBack,
  embedded = false,
}: PromptScanViewProps) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [selectedScan, setSelectedScan] = useState<PromptScanData | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<UsageData | null>(null);

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
              scan: scan as unknown as PromptScanData,
              usage: (detail?.usage as unknown as UsageData) ?? null,
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
        scan: scan as unknown as PromptScanData,
        usage: usage as unknown as UsageData,
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
    (scan: PromptScanData, usage: UsageData | null) => {
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
          setSelectedScan(detail.scan as unknown as PromptScanData);
          setSelectedUsage((detail.usage as unknown as UsageData) ?? null);
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
    <div className="prompt-scan-view">
      {/* Header - hidden in embedded mode */}
      {!embedded && (
        <div className="prompt-scan-header">
          <h2>Prompt CT Scan</h2>
          <button onClick={onBack} className="prompt-scan-back-btn">
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
        <div className="session-info-bar">
          <span className="session-info-label">
            Session:{" "}
            <span className="session-info-id">
              {sessionId.slice(0, 8)}...{sessionId.slice(-4)}
            </span>
          </span>
          <span className="session-info-summary">
            {messages.length} messages | {formatCost(sessionCost)}
          </span>
        </div>
      )}

      {/* Message Feed */}
      <div style={{ marginBottom: 16 }}>
        <div className="message-feed-title">Messages</div>
        {loading ? (
          <div className="message-feed-loading">Loading...</div>
        ) : initError ? (
          <div className="message-feed-error">{initError}</div>
        ) : messages.length === 0 ? (
          <div className="message-feed-empty">
            No messages yet. Make API requests through the proxy to see CT scan
            data.
          </div>
        ) : (
          <div ref={feedRef} className="message-feed-scroll">
            {messages.map((item) => {
              const { scan, usage } = item;
              const ctx = scan.context_estimate;
              const total = ctx.total_tokens || 1;
              const isSelected = selectedScan?.request_id === scan.request_id;

              return (
                <div
                  key={scan.request_id}
                  className="message-card"
                  style={{
                    background: isSelected
                      ? "rgba(99, 102, 241, 0.15)"
                      : "rgba(255,255,255,0.05)",
                    borderLeft: `3px solid ${getModelColor(scan.model)}`,
                  }}
                  onClick={() => handleMessageClick(item)}
                >
                  {/* Prompt text + time */}
                  <div className="message-card-top">
                    <div className="message-card-prompt">
                      {scan.user_prompt || "(system)"}
                    </div>
                    <div className="message-card-time">
                      {formatTimeAgo(scan.timestamp)}
                    </div>
                  </div>

                  {/* Model + cost + context ratio bar */}
                  <div className="message-card-meta">
                    <span className="message-card-model" style={{ color: getModelColor(scan.model) }}>
                      {getModelShort(scan.model)}
                    </span>
                    <span className="message-card-cost">
                      {formatCost(usage?.cost_usd ?? 0)}
                    </span>
                    <span className="message-card-tokens">
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
                        <div className="ctx-ratio-bar">
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

                    <span className="ctx-ratio-pct">
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
        <div style={{ marginTop: 16 }}>
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
