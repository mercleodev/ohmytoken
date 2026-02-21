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
    <div
      style={{
        padding: 16,
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        minHeight: "100%",
        color: "#fff",
      }}
    >
      {/* Header - hidden in embedded mode */}
      {!embedded && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Prompt CT Scan
          </h2>
          <button
            onClick={onBack}
            style={{
              padding: "6px 14px",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
            }}
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
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span style={{ color: "#94a3b8" }}>
            Session:{" "}
            <span
              style={{
                color: "#cbd5e1",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {sessionId.slice(0, 8)}...{sessionId.slice(-4)}
            </span>
          </span>
          <span style={{ color: "#94a3b8" }}>
            {messages.length} messages | {formatCost(sessionCost)}
          </span>
        </div>
      )}

      {/* Message Feed */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "#e2e8f0",
            marginBottom: 8,
          }}
        >
          Messages
        </div>
        {loading ? (
          <div style={{ color: "#94a3b8", fontSize: 12, padding: 12 }}>
            Loading...
          </div>
        ) : initError ? (
          <div
            style={{
              color: "#f87171",
              fontSize: 12,
              padding: 12,
              background: "rgba(239, 68, 68, 0.1)",
              borderRadius: 6,
              border: "1px solid rgba(239, 68, 68, 0.2)",
            }}
          >
            {initError}
          </div>
        ) : messages.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 12, padding: 12 }}>
            No messages yet. Make API requests through the proxy to see CT scan
            data.
          </div>
        ) : (
          <div
            ref={feedRef}
            style={{
              maxHeight: 260,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {messages.map((item) => {
              const { scan, usage } = item;
              const ctx = scan.context_estimate;
              const total = ctx.total_tokens || 1;
              const isSelected = selectedScan?.request_id === scan.request_id;

              return (
                <button
                  key={scan.request_id}
                  className="message-card"
                  style={{
                    padding: "8px 10px",
                    background: isSelected
                      ? "rgba(99, 102, 241, 0.15)"
                      : "rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    borderLeft: `3px solid ${getModelColor(scan.model)}`,
                    cursor: "pointer",
                    transition: "background 0.15s",
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    font: "inherit",
                    color: "inherit",
                  }}
                  aria-label={`Prompt: ${(scan.user_prompt || "(system)").slice(0, 50)}`}
                  onClick={() => handleMessageClick(item)}
                >
                  {/* Prompt text + time */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: "#e2e8f0",
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        marginRight: 8,
                      }}
                    >
                      {scan.user_prompt || "(system)"}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatTimeAgo(scan.timestamp)}
                    </div>
                  </div>

                  {/* Model + cost + context ratio bar */}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: getModelColor(scan.model),
                        fontWeight: 500,
                      }}
                    >
                      {getModelShort(scan.model)}
                    </span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>
                      {formatCost(usage?.cost_usd ?? 0)}
                    </span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>
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
                        <div
                          style={{
                            flex: 1,
                            display: "flex",
                            height: 4,
                            borderRadius: 2,
                            overflow: "hidden",
                            background: "rgba(255,255,255,0.08)",
                          }}
                        >
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

                    <span
                      style={{
                        fontSize: 9,
                        color: "#64748b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      S{((ctx.system_tokens / total) * 100).toFixed(0)}% M
                      {((ctx.messages_tokens / total) * 100).toFixed(0)}% T
                      {((ctx.tools_definition_tokens / total) * 100).toFixed(0)}
                      %
                    </span>
                  </div>
                </button>
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
