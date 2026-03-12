import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  formatCost,
  formatTokens,
  formatTimeAgo,
  getModelShort,
  getModelColor,
  getContextLimit,
  getGaugeColor,
} from "../scan/shared";
import { scrollToBottom } from "../../hooks";
import type { PromptScan, UsageLogEntry, HistoryEntry, SessionMcpAnalysis } from "../../types";
import { CacheGrowthChart } from "./CacheGrowthChart";
import { SessionAlertBanner } from "./SessionAlert";
import { getSessionAlerts } from "../../utils/sessionAlerts";
import { getEfficiency } from "../../utils/efficiency";
import { FEATURE_FLAGS } from "../../config/featureFlags";

type MessageItem = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

const CONTINUATION_PROMPT_MARKER =
  "This session is being continued from a previous conversation that ran out of context";

const getCacheHitPct = (usage: UsageLogEntry | null): number | null => {
  if (!usage) return null;
  const base =
    usage.response.input_tokens +
    usage.response.cache_read_input_tokens +
    usage.response.cache_creation_input_tokens;
  if (base <= 0) return null;
  return (usage.response.cache_read_input_tokens / base) * 100;
};

const formatSignedTokens = (value: number): string =>
  `${value >= 0 ? "+" : "-"}${formatTokens(Math.abs(value))}`;

const formatSignedCost = (value: number): string =>
  `${value >= 0 ? "+" : "-"}${formatCost(Math.abs(value))}`;

const getMessageKey = (item: MessageItem): string => {
  const requestId = (item.scan.request_id || "").trim();
  if (requestId) return requestId;
  return `${item.scan.session_id}:${item.scan.timestamp}`;
};

const COMPACTION_MARKER = "Compacted (ctrl+o to see full summary)";

const stripAnsi = (text: string): string =>
  text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[[\d;]*m/g, "");

const isDisplayablePrompt = (scan: PromptScan): boolean => {
  const model = (scan.model ?? "").toLowerCase();
  if (model.includes("synthetic")) return false;

  const promptText = stripAnsi(scan.user_prompt ?? "").trim();
  if (promptText.includes(CONTINUATION_PROMPT_MARKER)) return false;
  if (promptText.includes(COMPACTION_MARKER)) return false;

  const totalTokens = scan.context_estimate?.total_tokens ?? 0;
  return totalTokens > 0 || promptText.length > 0;
};

const upsertMessage = (
  items: MessageItem[],
  next: MessageItem,
  insertAtFront = false,
): MessageItem[] => {
  const key = getMessageKey(next);
  const existingIdx = items.findIndex((item) => getMessageKey(item) === key);

  if (existingIdx === -1) {
    return insertAtFront ? [next, ...items] : [...items, next];
  }

  const existing = items[existingIdx];
  const existingTokens = existing.scan.context_estimate?.total_tokens ?? 0;
  const nextTokens = next.scan.context_estimate?.total_tokens ?? 0;
  const shouldReplace = Boolean(next.usage && !existing.usage) || nextTokens > existingTokens;

  if (!shouldReplace) return items;
  const cloned = [...items];
  cloned[existingIdx] = next;
  return cloned;
};

type SessionDetailViewProps = {
  sessionId: string;
  onBack: () => void;
  onSelectPrompt: (scan: PromptScan, usage: UsageLogEntry | null) => void;
};

export const SessionDetailView = ({
  sessionId,
  onBack,
  onSelectPrompt,
}: SessionDetailViewProps) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasScanData, setHasScanData] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [mcpAnalysis, setMcpAnalysis] = useState<SessionMcpAnalysis | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Reusable: build MessageItem[] from DB scans for a given session
  const buildMessagesFromDb = useCallback(async (sid: string): Promise<MessageItem[]> => {
    const dbScans = await window.api.getPromptScans({ session_id: sid, limit: 200 });
    const items: MessageItem[] = [];
    for (const scan of dbScans) {
      try {
        const detail = await window.api.getPromptScanDetail(scan.request_id);
        if (detail && isDisplayablePrompt(detail.scan)) {
          items.push({ scan: detail.scan, usage: detail.usage ?? null });
        }
      } catch {
        if (isDisplayablePrompt(scan)) {
          items.push({ scan, usage: null });
        }
      }
    }
    return items;
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        // === DB-first loading (provider-agnostic) ===
        const dbItems = await buildMessagesFromDb(sessionId);
        if (dbItems.length > 0) {
          setHasScanData(true);
          setMessages(dbItems);
          setLoading(false);

          // Supplement: check for newer prompts in history not yet in DB
          // (e.g., latest prompt where assistant response hasn't arrived yet)
          try {
            const latestDbTs = new Date(dbItems[0].scan.timestamp).getTime();
            const allHistory = await window.api.getRecentHistory(100);
            const newerEntries = allHistory.filter(
              (e) => e.sessionId === sessionId && e.timestamp > latestDbTs,
            );
            for (const entry of newerEntries) {
              try {
                const detail = await window.api.getHistoryPromptDetail(
                  entry.sessionId,
                  entry.timestamp,
                );
                if (detail && isDisplayablePrompt(detail.scan)) {
                  setMessages((prev) =>
                    upsertMessage(
                      prev,
                      { scan: detail.scan, usage: detail.usage ?? null },
                      true,
                    ),
                  );
                }
              } catch {
                /* detail not yet available */
              }
            }
          } catch {
            /* history supplement is best-effort */
          }

          return; // DB path succeeded
        }

        // === Fallback: Claude history-based path ===
        const allHistory = await window.api.getRecentHistory(500);
        const sorted = allHistory
          .filter((e) => e.sessionId === sessionId)
          .sort((a, b) => b.timestamp - a.timestamp);

        const seenTs = new Set<number>();
        const deduped: HistoryEntry[] = [];
        for (const e of sorted) {
          if (seenTs.has(e.timestamp)) continue;
          seenTs.add(e.timestamp);
          deduped.push(e);
        }
        setHistoryEntries(deduped);

        let items: MessageItem[] = [];
        for (const entry of deduped) {
          try {
            const detail = await window.api.getHistoryPromptDetail(
              entry.sessionId,
              entry.timestamp,
            );
            if (detail && detail.scan) {
              items = upsertMessage(
                items,
                {
                  scan: detail.scan,
                  usage: detail.usage ?? null,
                },
                false,
              );
            }
          } catch {
            /* skip */
          }
        }

        const displayItems = items.filter((m) => isDisplayablePrompt(m.scan));

        if (displayItems.length > 0) {
          setHasScanData(true);
          setMessages(displayItems);
        }
      } catch (err) {
        console.error("Failed to load session detail:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId, buildMessagesFromDb]);

  // Fetch MCP analysis for the session (gated by feature flag)
  useEffect(() => {
    if (!FEATURE_FLAGS.MCP_INSIGHTS) return;
    window.api.getSessionMcpAnalysis(sessionId)
      .then(setMcpAnalysis)
      .catch(() => { /* MCP analysis unavailable */ });
  }, [sessionId]);

  // Real-time: new history entries with retry-enrichment (mirrors Dashboard approach)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const RETRY_DELAYS = [3_000, 8_000, 20_000];

    const tryEnrich = async (entry: HistoryEntry) => {
      try {
        const detail = await window.api.getHistoryPromptDetail(
          entry.sessionId,
          entry.timestamp,
        );
        if (detail && detail.scan) {
          const scan = detail.scan;
          if (isDisplayablePrompt(scan)) {
            setHasScanData(true);
            setMessages((prev) => {
              return upsertMessage(
                prev,
                {
                  scan,
                  usage: detail.usage ?? null,
                },
                true,
              );
            });
            scrollToBottom(feedRef);
            return true;
          }
        }
      } catch {
        /* detail not yet available */
      }
      return false;
    };

    const cleanup = window.api.onNewHistoryEntry((entry) => {
      if (entry.sessionId !== sessionId) return;
      setHistoryEntries((prev) => [...prev, entry]);
      scrollToBottom(feedRef);

      // Clear pending retries from previous entries
      timers.forEach(clearTimeout);
      timers.length = 0;

      // Attempt enrichment immediately, then retry
      tryEnrich(entry);
      for (const delay of RETRY_DELAYS) {
        const t = setTimeout(() => tryEnrich(entry), delay);
        timers.push(t);
      }
    });

    return () => {
      cleanup();
      timers.forEach(clearTimeout);
    };
  }, [sessionId]);

  // Real-time: proxy scan updates (supplement — captures cost data)
  useEffect(() => {
    const cleanup = window.api.onNewPromptScan(({ scan, usage }) => {
      if (scan.session_id !== sessionId) return;
      if (!isDisplayablePrompt(scan)) return;
      setHasScanData(true);
      setMessages((prev) => {
        return upsertMessage(
          prev,
          {
            scan,
            usage: usage ?? null,
          },
          true,
        );
      });
      scrollToBottom(feedRef);
    });
    return cleanup;
  }, [sessionId]);

  // Real-time: backfill completion → refresh DB data (Codex/Gemini sessions)
  useEffect(() => {
    const cleanup = window.api.onBackfillComplete(async () => {
      const items = await buildMessagesFromDb(sessionId);
      if (items.length > 0) {
        setHasScanData(true);
        setMessages(items);
        scrollToBottom(feedRef);
      }
    });
    return cleanup;
  }, [sessionId, buildMessagesFromDb]);

  // Session total cost: sum of all prompt costs
  const sessionTotalCost = messages.reduce(
    (sum, m) => sum + (m.usage?.cost_usd ?? 0),
    0,
  );

  // Latest context usage (scan data) — messages sorted newest-first, so [0] = latest
  const latestMsg = messages.length > 0 ? messages[0] : null;
  const latestCtxLimit = latestMsg ? getContextLimit(latestMsg.scan.model) : 0;
  const latestCtxPct = latestMsg
    ? Math.min(
        ((latestMsg.scan.context_estimate?.total_tokens ?? 0) /
          latestCtxLimit) *
          100,
        100,
      )
    : 0;
  const latestGaugeColor = getGaugeColor(latestCtxPct);

  // Latest context tokens for the donut gauge
  const latestCtxTokens = latestMsg?.scan.context_estimate?.total_tokens ?? 0;
  const latestCacheHitPct = latestMsg ? getCacheHitPct(latestMsg.usage) : null;

  // Efficiency & alerts computation
  const { totalOutput, totalAll, totalCacheRead } = useMemo(() => {
    let out = 0;
    let all = 0;
    let cache = 0;
    for (const m of messages) {
      const u = m.usage?.response;
      if (u) {
        out += u.output_tokens;
        cache += u.cache_read_input_tokens;
        all +=
          u.input_tokens +
          u.output_tokens +
          u.cache_creation_input_tokens +
          u.cache_read_input_tokens;
      }
    }
    return { totalOutput: out, totalAll: all, totalCacheRead: cache };
  }, [messages]);

  const efficiency = useMemo(
    () => getEfficiency(totalOutput, totalAll),
    [totalOutput, totalAll],
  );

  const sessionAlerts = useMemo(
    () =>
      getSessionAlerts({
        turnCount: messages.length,
        totalOutput,
        totalCacheRead,
        totalAll,
        mcpAnalysis: mcpAnalysis ?? undefined,
      }),
    [messages.length, totalOutput, totalCacheRead, totalAll, mcpAnalysis],
  );

  // Turn click → navigate to matching prompt detail
  const handleTurnClick = useCallback(
    (_turnIndex: number, timestamp: string, requestId: string) => {
      // Prefer exact match by request_id
      const exactMatch = messages.find(
        (m) => (m.scan.request_id || "").trim() === requestId,
      );
      if (exactMatch) {
        onSelectPrompt(exactMatch.scan, exactMatch.usage);
        return;
      }
      // Fallback: closest timestamp match
      const turnTime = new Date(timestamp).getTime();
      let best: MessageItem | null = null;
      let bestDelta = Infinity;
      for (const m of messages) {
        const delta = Math.abs(new Date(m.scan.timestamp).getTime() - turnTime);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = m;
        }
      }
      if (best) {
        onSelectPrompt(best.scan, best.usage);
      }
    },
    [messages, onSelectPrompt],
  );

  // Session title: first user message (oldest), cleaned up
  const firstPrompt =
    messages.length > 0
      ? messages[messages.length - 1].scan.user_prompt
      : historyEntries.length > 0
        ? historyEntries[historyEntries.length - 1]?.display
        : "";
  const sessionTitle =
    (firstPrompt || "")
      .replace(/<[^>]+>/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50) || "";

  return (
    <div>
      {/* Header */}
      <div className="session-detail-header">
        <button className="session-back-btn" onClick={onBack}>
          &#8249; Back
        </button>
        {sessionTitle && (
          <span className="session-detail-title">{sessionTitle}</span>
        )}
      </div>

      {/* Context Donut Gauge */}
      {hasScanData && !loading && latestMsg && (
        <SessionDonutGauge
          ctxPct={latestCtxPct}
          gaugeColor={latestGaugeColor}
          ctxTokens={latestCtxTokens}
          ctxLimit={latestCtxLimit}
          model={latestMsg.scan.model}
          promptCount={messages.length}
          totalCost={sessionTotalCost}
          cacheHitPct={latestCacheHitPct}
          efficiency={efficiency}
        />
      )}

      {/* Cache Growth Chart */}
      {hasScanData && !loading && messages.length >= 3 && (
        <CacheGrowthChart sessionId={sessionId} onTurnClick={handleTurnClick} />
      )}

      {/* Session Alerts */}
      {hasScanData && !loading && sessionAlerts.length > 0 && (
        <SessionAlertBanner alerts={sessionAlerts} />
      )}

      {/* Prompt List */}
      <div className="prompt-list" ref={feedRef}>
        {loading ? (
          <div className="prompt-list-loading">
            <div className="spinner" />
          </div>
        ) : hasScanData && messages.length > 0 ? (
          /* Scan-enriched prompt list */
          messages
            .filter((item) => {
              const t = item.scan.user_prompt || "";
              return !t.includes(CONTINUATION_PROMPT_MARKER);
            })
            .map((item, i) => {
              const nextItem = messages[i + 1];
              const currentCtx = item.scan.context_estimate?.total_tokens ?? 0;
              const previousCtx = nextItem?.scan.context_estimate?.total_tokens ?? null;
              const deltaCtx =
                previousCtx === null ? null : currentCtx - previousCtx;
              const cacheHitPct = getCacheHitPct(item.usage);
              const currentCost = item.usage?.cost_usd ?? null;
              const previousCost = nextItem?.usage?.cost_usd ?? null;
              const deltaCost =
                currentCost === null || previousCost === null
                  ? null
                  : currentCost - previousCost;

              return (
                <motion.button
                  key={item.scan.request_id}
                  className="prompt-card"
                  onClick={() => onSelectPrompt(item.scan, item.usage)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <div className="prompt-card-top">
                    <span
                      className="prompt-card-model"
                      style={{ color: getModelColor(item.scan.model) }}
                    >
                      {getModelShort(item.scan.model)}
                    </span>
                    <span className="prompt-card-time">
                      {formatTimeAgo(item.scan.timestamp)}
                    </span>
                  </div>
                  <div className="prompt-card-text">
                    {item.scan.user_prompt
                      ? item.scan.user_prompt.slice(0, 80) +
                        (item.scan.user_prompt.length > 80 ? "..." : "")
                      : "(system request)"}
                  </div>
                  <div className="prompt-card-journey">
                    <span className="prompt-card-journey-chip">
                      Prompt {formatTokens(item.scan.user_prompt_tokens || 0)}
                    </span>
                    <span className="prompt-card-journey-chip">
                      Injected {item.scan.injected_files.length} files
                    </span>
                    <span className="prompt-card-journey-chip">
                      Actions {item.scan.tool_calls.length}
                    </span>
                    {cacheHitPct !== null && (
                      <span className="prompt-card-journey-chip cache">
                        Cache {cacheHitPct.toFixed(1)}%
                      </span>
                    )}
                    {deltaCtx !== null && (
                      <span className="prompt-card-journey-chip delta">
                        ΔCtx {formatSignedTokens(deltaCtx)}
                      </span>
                    )}
                    {deltaCost !== null && (
                      <span className="prompt-card-journey-chip delta">
                        ΔCost {formatSignedCost(deltaCost)}
                      </span>
                    )}
                  </div>
                  {item.scan.assistant_response && (
                    <div className="prompt-card-response">
                      {item.scan.assistant_response.slice(0, 100)}
                    </div>
                  )}
                  {/* Context composition bar */}
                  {(() => {
                    const ce = item.scan.context_estimate;
                    if (!ce || ce.total_tokens <= 0) return null;
                    const hasDetailedBd = ce.system_tokens > 0 || ce.messages_tokens > 0;

                    if (!hasDetailedBd) {
                      // Non-Claude: single bar showing total input
                      return (
                        <div className="prompt-card-injected">
                          <div className="prompt-card-injected-bar">
                            <div
                              className="injected-segment"
                              data-tooltip={`Input · ${formatTokens(ce.total_tokens)}`}
                              style={{ width: "100%", background: "#3b82f6" }}
                            />
                          </div>
                        </div>
                      );
                    }

                    const bd = ce.messages_tokens_breakdown;
                    const hasBd =
                      bd &&
                      (bd.user_text_tokens > 0 ||
                        bd.assistant_tokens > 0 ||
                        bd.tool_result_tokens > 0);
                    const sysPct = (ce.system_tokens / ce.total_tokens) * 100;
                    const utPct = hasBd
                      ? (bd.user_text_tokens / ce.total_tokens) * 100
                      : 0;
                    const asPct = hasBd
                      ? (bd.assistant_tokens / ce.total_tokens) * 100
                      : 0;
                    const trPct = hasBd
                      ? (bd.tool_result_tokens / ce.total_tokens) * 100
                      : 0;
                    const convTokens =
                      ce.messages_tokens - (bd?.tool_result_tokens ?? 0);
                    const convPct = !hasBd
                      ? (convTokens / ce.total_tokens) * 100
                      : 0;
                    const tdPct =
                      (ce.tools_definition_tokens / ce.total_tokens) * 100;
                    return (
                      <div className="prompt-card-injected">
                        <div className="prompt-card-injected-bar">
                          {sysPct > 0 && (
                            <div
                              className="injected-segment"
                              data-tooltip={`System · ${formatTokens(ce.system_tokens)}`}
                              style={{
                                width: `${sysPct}%`,
                                background: "#8b5cf6",
                              }}
                            />
                          )}
                          {hasBd ? (
                            <>
                              {utPct > 0 && (
                                <div
                                  className="injected-segment"
                                  data-tooltip={`Your Prompts · ${formatTokens(bd.user_text_tokens)}`}
                                  style={{
                                    width: `${utPct}%`,
                                    background: "#3b82f6",
                                  }}
                                />
                              )}
                              {asPct > 0 && (
                                <div
                                  className="injected-segment"
                                  data-tooltip={`Responses · ${formatTokens(bd.assistant_tokens)}`}
                                  style={{
                                    width: `${asPct}%`,
                                    background: "#60a5fa",
                                  }}
                                />
                              )}
                              {trPct > 0 && (
                                <div
                                  className="injected-segment"
                                  data-tooltip={`Action Results · ${formatTokens(bd.tool_result_tokens)}`}
                                  style={{
                                    width: `${trPct}%`,
                                    background: "#06b6d4",
                                  }}
                                />
                              )}
                            </>
                          ) : (
                            convPct > 0 && (
                              <div
                                className="injected-segment"
                                data-tooltip={`Messages · ${formatTokens(convTokens)}`}
                                style={{
                                  width: `${convPct}%`,
                                  background: "#3b82f6",
                                }}
                              />
                            )
                          )}
                          {tdPct > 0 && (
                            <div
                              className="injected-segment"
                              data-tooltip={`Tools Def · ${formatTokens(ce.tools_definition_tokens)}`}
                              style={{
                                width: `${tdPct}%`,
                                background: "#f59e0b",
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Compacted label: context dropped vs previous prompt (sorted newest-first) */}
                  {nextItem && currentCtx < previousCtx! * 0.8 && (
                    <span className="prompt-card-compacted">compacted</span>
                  )}
                  <div className="prompt-card-meta">
                    <span>{formatTokens(currentCtx)} tokens</span>
                    {item.usage && (
                      <>
                        <span>&middot;</span>
                        <span>{formatCost(item.usage.cost_usd)}</span>
                      </>
                    )}
                    <span className="prompt-card-chevron">&rsaquo;</span>
                  </div>
                </motion.button>
              );
            })
        ) : historyEntries.length === 0 ? (
          <div className="prompt-list-empty">No prompts found</div>
        ) : (
          /* History-based prompt list */
          historyEntries.map((entry, i) => {
            const displayText = entry.display || "(system request)";
            const isLoading = loadingIdx === i;
            return (
              <motion.button
                key={`${entry.sessionId}-${entry.timestamp}-${i}`}
                className="prompt-card"
                style={{ opacity: isLoading ? 0.6 : 1 }}
                onClick={async () => {
                  if (isLoading) return;
                  setLoadingIdx(i);
                  try {
                    const detail = await window.api.getHistoryPromptDetail(
                      entry.sessionId,
                      entry.timestamp,
                    );
                    if (detail) {
                      onSelectPrompt(
                        detail.scan as PromptScan,
                        detail.usage as UsageLogEntry | null,
                      );
                    }
                  } catch (err) {
                    console.error("Failed to load history prompt detail:", err);
                  } finally {
                    setLoadingIdx(null);
                  }
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
              >
                <div className="prompt-card-top">
                  <span
                    className="prompt-card-model"
                    style={{ color: "#8e8e93" }}
                  >
                    Prompt
                  </span>
                  <span className="prompt-card-time">
                    {formatTimeAgo(new Date(entry.timestamp).toISOString())}
                  </span>
                </div>
                <div className="prompt-card-text">
                  {displayText.slice(0, 80) +
                    (displayText.length > 80 ? "..." : "")}
                </div>
                <div className="prompt-card-meta">
                  {entry.project && (
                    <>
                      <span>{entry.project.split("/").pop()}</span>
                      <span>&middot;</span>
                    </>
                  )}
                  <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className="prompt-card-chevron">&rsaquo;</span>
                </div>
              </motion.button>
            );
          })
        )}
      </div>
    </div>
  );
};

// --- Sub Components ---

const DONUT_RADIUS = 52;
const DONUT_STROKE_WIDTH = 10;
const DONUT_TRANSITION_SECONDS = 0.4;

type EfficiencyInfo = {
  outputRatio: number;
  grade: string;
  label: string;
  color: string;
};

type SessionDonutGaugeProps = {
  ctxPct: number;
  gaugeColor: string;
  ctxTokens: number;
  ctxLimit: number;
  model: string;
  promptCount: number;
  totalCost: number;
  cacheHitPct: number | null;
  efficiency?: EfficiencyInfo;
};

const SessionDonutGauge = ({
  ctxPct,
  gaugeColor,
  ctxTokens,
  ctxLimit,
  model,
  promptCount,
  totalCost,
  cacheHitPct,
  efficiency,
}: SessionDonutGaugeProps) => {
  const circumference = 2 * Math.PI * DONUT_RADIUS;
  const filled = (ctxPct / 100) * circumference;
  const svgSize = (DONUT_RADIUS + DONUT_STROKE_WIDTH) * 2;
  const center = svgSize / 2;

  return (
    <div className="session-donut-gauge">
      <div className="session-donut-svg-wrap">
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
        >
          <circle
            cx={center}
            cy={center}
            r={DONUT_RADIUS}
            fill="none"
            stroke="var(--gauge-track, rgba(0,0,0,0.06))"
            strokeWidth={DONUT_STROKE_WIDTH}
          />
          <circle
            cx={center}
            cy={center}
            r={DONUT_RADIUS}
            fill="none"
            stroke={gaugeColor}
            strokeWidth={DONUT_STROKE_WIDTH}
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${center} ${center})`}
            style={{ transition: `stroke-dasharray ${DONUT_TRANSITION_SECONDS}s ease` }}
          />
        </svg>
        <div className="session-donut-label">
          <span className="session-donut-pct" style={{ color: gaugeColor }}>
            {Math.round(ctxPct)}%
          </span>
          <span className="session-donut-sub">Context Used</span>
        </div>
      </div>
      <div className="session-donut-info">
        <div className="session-donut-row">
          <span>Used</span>
          <span>{formatTokens(ctxTokens)}</span>
        </div>
        <div className="session-donut-row">
          <span>Limit</span>
          <span>{formatTokens(ctxLimit)}</span>
        </div>
        <div className="session-donut-row">
          <span>Model</span>
          <span style={{ color: getModelColor(model) }}>
            {getModelShort(model)}
          </span>
        </div>
        <div className="session-donut-row">
          <span>Prompts</span>
          <span>{promptCount}</span>
        </div>
        {totalCost > 0 && (
          <div className="session-donut-row session-donut-row--cost">
            <span>Cost</span>
            <span>{formatCost(totalCost)}</span>
          </div>
        )}
        {cacheHitPct !== null && (
          <div className="session-donut-row">
            <span>Cache hit</span>
            <span>{cacheHitPct.toFixed(1)}%</span>
          </div>
        )}
        {efficiency && efficiency.outputRatio > 0 && (
          <div className="session-donut-row">
            <span>Efficiency</span>
            <span>
              {(efficiency.outputRatio * 100).toFixed(2)}%{' '}
              <span
                className="efficiency-badge"
                style={{ color: efficiency.color }}
              >
                {efficiency.grade}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
