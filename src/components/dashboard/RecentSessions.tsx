import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  formatTimeAgo,
  formatTokens,
  getModelShort,
  getModelColor,
  getContextLimit,
  getGaugeColor,
} from "../scan/shared";
import { useWindowFocusRefresh } from "../../hooks";
import type { PromptScan, HistoryEntry } from "../../types";
import { PROVIDER_COLORS, PROVIDER_ICONS } from "./ProviderTabs";
import type { ProviderFilter } from "./ProviderTabs";

type PromptItem = {
  key: string;
  sessionId: string;
  timestamp: string;
  text: string;
  project?: string;
  model?: string;
  totalTokens?: number;
  provider?: string;
  gitBranch?: string;
  compacted?: boolean;
};

type RecentSessionsProps = {
  onSelectSession: (sessionId: string) => void;
  scanRevision?: number;
  provider?: string;
};

const INITIAL_LIMIT = 5;
const BATCH_SIZE = 20;

/** Patterns indicating system/tool messages that should not appear as user prompts */
const SYSTEM_PROMPT_PATTERNS = [
  "Compacted (ctrl+o to see full summary)",
  "This session is being continued from a previous conversation",
  "Read the output file to retrieve the result:",
];

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text: string): string =>
  text.replace(ANSI_RE, "").replace(/\[[\d;]*m/g, "");

const isSystemPrompt = (text: string): boolean => {
  const clean = stripAnsi(text).trim();
  return SYSTEM_PROMPT_PATTERNS.some((p) => clean.includes(p));
};

const buildPromptItems = (
  entries: HistoryEntry[],
  scans: PromptScan[],
): PromptItem[] => {
  // Sort newest-first, then dedup
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);

  // Pass 1: exact dedup by sessionId+timestamp
  const seenExact = new Set<string>();
  const pass1 = sorted.filter((e) => {
    const k = `${e.sessionId}-${e.timestamp}`;
    if (seenExact.has(k)) return false;
    seenExact.add(k);
    return true;
  });

  // Pass 1.5: filter out system/tool messages
  const pass1b = pass1.filter((e) => !isSystemPrompt(e.display || ""));

  // Pass 2: near-dedup by display text within 60s window (cross-session)
  // Keep the entry with more data (has token info)
  const unique: HistoryEntry[] = [];
  for (const e of pass1b) {
    const displayKey = (e.display || "").slice(0, 80).trim();
    if (!displayKey) {
      unique.push(e);
      continue;
    }

    const dup = unique.find(
      (u) =>
        (u.display || "").slice(0, 80).trim() === displayKey &&
        Math.abs(u.timestamp - e.timestamp) < 60_000,
    );
    if (dup) {
      // Keep the one with richer data
      if (!dup.totalContextTokens && e.totalContextTokens) {
        const idx = unique.indexOf(dup);
        unique[idx] = e;
      }
      continue;
    }
    unique.push(e);
  }

  return unique.map((e) => {
    const ts = new Date(e.timestamp).toISOString();
    const item: PromptItem = {
      key: `${e.sessionId}-${e.timestamp}`,
      sessionId: e.sessionId,
      timestamp: ts,
      text: e.display || "(system)",
      project: e.project || undefined,
      provider: 'claude', // History entries are always from Claude watcher
    };

    // Primary: use enriched data from main process (session JSONL)
    if (e.totalContextTokens && e.totalContextTokens > 0 && e.model) {
      item.model = e.model;
      item.totalTokens = e.totalContextTokens;
      return item;
    }

    // Fallback: match scan by timestamp proximity (within 5s)
    const entryTime = e.timestamp;
    let bestMatch: PromptScan | undefined;
    let bestDelta = Infinity;
    for (const s of scans) {
      const delta = Math.abs(new Date(s.timestamp).getTime() - entryTime);
      if (delta < 5000 && delta < bestDelta) {
        bestDelta = delta;
        bestMatch = s;
      }
    }
    if (bestMatch) {
      item.model = bestMatch.model;
      item.totalTokens = bestMatch.context_estimate?.total_tokens ?? 0;
      item.provider = bestMatch.provider ?? 'claude';
      item.gitBranch = bestMatch.git_branch;
    }

    return item;
  });
};

/** Build PromptItems directly from DB scans (for non-Claude or All view) */
const buildPromptItemsFromScans = (scans: PromptScan[]): PromptItem[] => {
  const sorted = [...scans].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  // Dedup by request_id, filter system messages
  const seen = new Set<string>();
  return sorted
    .filter((s) => {
      if (seen.has(s.request_id)) return false;
      seen.add(s.request_id);
      if (isSystemPrompt(s.user_prompt || "")) return false;
      return true;
    })
    .map((s) => ({
      key: s.request_id,
      sessionId: s.session_id,
      timestamp: s.timestamp,
      text: s.user_prompt || "(system)",
      model: s.model,
      totalTokens: s.context_estimate?.total_tokens ?? 0,
      provider: s.provider ?? 'claude',
      gitBranch: s.git_branch,
    }));
};

/** Detect compaction events: context drop > 20% between consecutive prompts in same session */
const markCompacted = (items: PromptItem[]): PromptItem[] => {
  const bySession = new Map<string, PromptItem[]>();
  for (const item of items) {
    const group = bySession.get(item.sessionId) || [];
    group.push(item);
    bySession.set(item.sessionId, group);
  }

  const compactedKeys = new Set<string>();
  for (const [, group] of bySession) {
    // Sort oldest-first by timestamp
    const sorted = [...group].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].totalTokens;
      const curr = sorted[i].totalTokens;
      if (prev && prev > 0 && curr && curr < prev * 0.8) {
        compactedKeys.add(sorted[i].key);
      }
    }
  }

  if (compactedKeys.size === 0) return items;
  return items.map((item) => ({
    ...item,
    compacted: compactedKeys.has(item.key),
  }));
};

// Mini donut SVG for ctx %
const MiniCtxGauge = ({ pct, noData }: { pct: number; noData?: boolean }) => {
  const r = 14;
  const stroke = 3;
  const circumference = 2 * Math.PI * r;
  const size = (r + stroke) * 2;

  if (noData) {
    return (
      <div
        className="mini-ctx-gauge mini-ctx-gauge--nodata"
        title="Tracking unavailable"
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#E8E8ED"
            strokeWidth={stroke}
            strokeDasharray="4 3"
          />
        </svg>
        <span className="mini-ctx-gauge-pct" style={{ color: "#C0C0C4" }}>
          --
        </span>
      </div>
    );
  }

  const offset = circumference * (1 - Math.min(pct, 100) / 100);
  const color = getGaugeColor(pct);

  return (
    <div className="mini-ctx-gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#E8E8ED"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="mini-ctx-gauge-pct" style={{ color }}>
        {Math.round(pct)}%
      </span>
    </div>
  );
};

/** Compact provider badge: colored icon */
const ProviderBadge = ({ provider }: { provider: string }) => {
  const pid = provider as ProviderFilter;
  const color = PROVIDER_COLORS[pid] ?? '#8e8e93';
  const icon = PROVIDER_ICONS[pid] ?? provider.charAt(0).toUpperCase();
  return (
    <span
      className="provider-badge"
      style={{ color }}
      title={provider.charAt(0).toUpperCase() + provider.slice(1)}
    >
      {icon}
    </span>
  );
};

export const RecentSessions = ({
  onSelectSession,
  scanRevision,
  provider,
}: RecentSessionsProps) => {
  const [allPrompts, setAllPrompts] = useState<PromptItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);
  const entriesRef = useRef<HistoryEntry[]>([]);
  const scansRef = useRef<PromptScan[]>([]);

  // Show provider badge when viewing "all" (provider is undefined)
  const showBadge = !provider;

  const refresh = useCallback(() => {
    if (provider === 'claude') {
      setAllPrompts(markCompacted(buildPromptItems(entriesRef.current, scansRef.current)));
    } else {
      // All tab (!provider) and non-Claude providers: use DB scans as primary source
      setAllPrompts(markCompacted(buildPromptItemsFromScans(scansRef.current)));
    }
  }, [provider]);

  const loadData = useCallback(async () => {
    try {
      if (provider === 'claude') {
        // Claude tab: use history entries as primary source
        const entries = await window.api.getRecentHistory(100);
        entriesRef.current = entries;
      }

      // Always load scans from DB (with optional provider filter)
      try {
        const scans = await window.api.getPromptScans({
          limit: provider ? 50 : 100,
          provider,
        });
        scansRef.current = scans;
      } catch (dbErr) {
        console.error("[RecentSessions] DB scan load failed:", dbErr);
      }

      if (provider === 'claude') {
        setAllPrompts(markCompacted(buildPromptItems(entriesRef.current, scansRef.current)));
      } else {
        // All tab (!provider) and non-Claude providers: use DB scans as primary source
        setAllPrompts(markCompacted(buildPromptItemsFromScans(scansRef.current)));
      }
    } catch (err) {
      console.error("Failed to load recent prompts:", err);
    } finally {
      setInitialized(true);
    }
  }, [provider]);

  // Load on mount + window focus
  useWindowFocusRefresh(loadData);

  // Real-time: new history entries with retry-enrichment.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const RETRY_DELAYS = [3000, 8000, 20000];

    const unsubscribe = window.api.onNewHistoryEntry((entry) => {
      entriesRef.current = [entry, ...entriesRef.current].slice(0, 500);
      refresh();

      // For non-Claude tabs (All, Codex, etc.): scansRef isn't updated by
      // onNewHistoryEntry, but importSinglePrompt has already written to DB
      // before this IPC event arrives. Reload from DB immediately.
      if (provider !== 'claude') {
        loadData();
        return;
      }

      // Claude tab: schedule retries for token enrichment.
      // Clear any pending retries from previous entries
      timers.forEach(clearTimeout);
      timers.length = 0;
      // Schedule retries: stop early if the newest entry gets enriched
      for (const delay of RETRY_DELAYS) {
        const t = setTimeout(async () => {
          const newest = entriesRef.current[0];
          if (newest?.totalContextTokens && newest.totalContextTokens > 0)
            return;
          await loadData();
        }, delay);
        timers.push(t);
      }
    });
    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [refresh, loadData, provider]);

  // Real-time: new scan events
  useEffect(() => {
    const cleanup = window.api.onNewPromptScan(({ scan }) => {
      const s = scan;
      scansRef.current = [s, ...scansRef.current].slice(0, 100);
      refresh();
    });
    return cleanup;
  }, [refresh]);

  // Reload on external scan revision or provider change
  useEffect(() => {
    loadData();
  }, [scanRevision, loadData]);

  // Load more history when expanding
  const handleViewMore = useCallback(async () => {
    setExpanded(true);
    setLoadingMore(true);
    try {
      if (provider === 'claude') {
        const entries = await window.api.getRecentHistory(500);
        entriesRef.current = entries;
      }

      const scans = await window.api.getPromptScans({
        limit: provider ? 200 : 500,
        provider,
      });
      scansRef.current = scans;

      if (provider === 'claude') {
        setAllPrompts(markCompacted(buildPromptItems(entriesRef.current, scansRef.current)));
      } else {
        // All tab (!provider) and non-Claude providers: use DB scans as primary source
        setAllPrompts(markCompacted(buildPromptItemsFromScans(scansRef.current)));
      }
      setVisibleCount(INITIAL_LIMIT + BATCH_SIZE);
    } catch (err) {
      console.error("Failed to load more prompts:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [provider]);

  // Show more items progressively
  const handleShowMore = useCallback(() => {
    setVisibleCount((prev) => prev + BATCH_SIZE);
  }, []);

  if (!initialized) return null;

  // In collapsed mode: show top 5. In expanded: show up to visibleCount.
  const displayPrompts = expanded
    ? allPrompts.slice(0, visibleCount)
    : allPrompts.slice(0, INITIAL_LIMIT);
  const hasMore = expanded && visibleCount < allPrompts.length;
  const canExpand = !expanded && allPrompts.length > INITIAL_LIMIT;

  return (
    <div className="recent-sessions">
      <div className="recent-sessions-header">
        <span className="recent-sessions-title">Recent Prompts</span>
        {allPrompts.length > 0 && (
          <span className="recent-sessions-count">{allPrompts.length}</span>
        )}
      </div>
      {allPrompts.length === 0 ? (
        <div className="recent-sessions-empty">
          <p>No prompts detected yet.</p>
          <p style={{ fontSize: 11, opacity: 0.6 }}>
            Prompts appear automatically when you use Claude Code.
          </p>
        </div>
      ) : (
        <>
          <AnimatePresence mode="popLayout" initial={false}>
            {displayPrompts.map((p) => {
              const hasCtx = (p.totalTokens ?? 0) > 0 && p.model;
              const ctxLimit = p.model ? getContextLimit(p.model) : 0;
              const ctxPct =
                hasCtx && ctxLimit > 0 ? (p.totalTokens! / ctxLimit) * 100 : 0;

              return (
                <motion.button
                  key={p.key}
                  layout
                  className="session-card"
                  aria-label={`${p.text.slice(0, 50)} - ${p.model ? getModelShort(p.model) : 'unknown model'} ${formatTimeAgo(p.timestamp)}`}
                  onClick={() => onSelectSession(p.sessionId)}
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 6 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                >
                  <div className="session-card-row">
                    <MiniCtxGauge pct={ctxPct} noData={!hasCtx} />
                    <div className="session-card-body">
                      <div className="session-card-top">
                        <span className="session-card-prompt">
                          {p.text.slice(0, 50)}
                          {p.text.length > 50 ? "..." : ""}
                        </span>
                        <span className="session-card-time">
                          {formatTimeAgo(p.timestamp)}
                        </span>
                      </div>
                      <div className="session-card-meta">
                        {showBadge && p.provider && (
                          <>
                            <ProviderBadge provider={p.provider} />
                            <span>&middot;</span>
                          </>
                        )}
                        {p.model && p.model !== "unknown" && (
                          <>
                            <span
                              style={{
                                color: getModelColor(p.model),
                                fontWeight: 600,
                              }}
                            >
                              {getModelShort(p.model)}
                            </span>
                            <span>&middot;</span>
                          </>
                        )}
                        {p.gitBranch && (
                          <>
                            <span className="session-card-branch">
                              {p.gitBranch}
                            </span>
                            <span>&middot;</span>
                          </>
                        )}
                        {hasCtx && (
                          <span>{formatTokens(p.totalTokens!)} tokens</span>
                        )}
                        {p.compacted && (
                          <span className="session-card-compacted-label">
                            Compacted
                          </span>
                        )}
                        {ctxPct >= 80 && !p.compacted && (
                          <span className="session-card-compact-hint">
                            Compact Suggested
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>

          {/* View More button (collapsed → expanded) */}
          {canExpand && (
            <button
              className="recent-view-more-btn"
              onClick={handleViewMore}
              disabled={loadingMore}
            >
              {loadingMore
                ? "Loading..."
                : `View More (${allPrompts.length - INITIAL_LIMIT})`}
            </button>
          )}

          {/* Load More button (progressive rendering within expanded) */}
          {hasMore && (
            <button className="recent-view-more-btn" onClick={handleShowMore}>
              Show More (
              {Math.min(BATCH_SIZE, allPrompts.length - visibleCount)} more)
            </button>
          )}
        </>
      )}
    </div>
  );
};
