import { useState, useEffect, useMemo } from 'react';
import { CATEGORY_COLORS } from '../scan/shared';
import { SummaryCards } from './SummaryCards';
import { CategoryDonutChart } from './CategoryDonutChart';
import { FileRankingTable } from './FileRankingTable';
import type { PromptScan, UsageLogEntry } from '../../types/electron.d';
import './context.css';

// --- Internal types ---

type FileRankEntry = {
  path: string;
  category: 'global' | 'project' | 'rules' | 'memory' | 'skill';
  injectionCount: number;
  cumulativeTokens: number;
  percentOfTotal: number;
};

type CategoryBreakdown = {
  category: string;
  totalTokens: number;
  percentage: number;
  color: string;
};

type SessionSummary = {
  totalInjectedTokens: number;
  totalSessionCost: number;
  injectedCostRatio: number;
  avgInjectedPerPrompt: number;
  promptCount: number;
};

type ScanWithUsage = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

// --- Aggregation logic (pure functions) ---

const aggregateData = (items: ScanWithUsage[]) => {
  const fileMap = new Map<string, {
    category: 'global' | 'project' | 'rules' | 'memory' | 'skill';
    injectionCount: number;
    cumulativeTokens: number;
  }>();

  const categoryMap = new Map<string, number>();
  let totalInjectedTokens = 0;
  let totalSessionCost = 0;

  for (const { scan, usage } of items) {
    totalSessionCost += usage?.cost_usd ?? 0;

    for (const file of scan.injected_files) {
      const existing = fileMap.get(file.path);
      if (existing) {
        existing.injectionCount += 1;
        existing.cumulativeTokens += file.estimated_tokens;
      } else {
        fileMap.set(file.path, {
          category: file.category,
          injectionCount: 1,
          cumulativeTokens: file.estimated_tokens,
        });
      }

      totalInjectedTokens += file.estimated_tokens;

      const catTokens = categoryMap.get(file.category) ?? 0;
      categoryMap.set(file.category, catTokens + file.estimated_tokens);
    }
  }

  // File ranking: sorted by cumulativeTokens descending
  const files: FileRankEntry[] = Array.from(fileMap.entries())
    .map(([path, data]) => ({
      path,
      ...data,
      percentOfTotal: totalInjectedTokens > 0
        ? (data.cumulativeTokens / totalInjectedTokens) * 100
        : 0,
    }))
    .sort((a, b) => b.cumulativeTokens - a.cumulativeTokens);

  // Category breakdown
  const CATEGORY_ORDER = ['global', 'project', 'rules', 'memory', 'skill'];
  const categories: CategoryBreakdown[] = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    totalTokens: categoryMap.get(cat) ?? 0,
    percentage: totalInjectedTokens > 0
      ? ((categoryMap.get(cat) ?? 0) / totalInjectedTokens) * 100
      : 0,
    color: CATEGORY_COLORS[cat] ?? '#6b7280',
  }));

  // Session summary
  const promptCount = items.length;
  const injectedCostRatio = totalSessionCost > 0
    ? (totalInjectedTokens / items.reduce((sum, { scan }) => sum + scan.context_estimate.total_tokens, 0)) * 100
    : 0;

  const summary: SessionSummary = {
    totalInjectedTokens,
    totalSessionCost,
    injectedCostRatio,
    avgInjectedPerPrompt: promptCount > 0 ? totalInjectedTokens / promptCount : 0,
    promptCount,
  };

  return { summary, categories, files };
};

// --- Component ---

export const ContextAnalysisView = () => {
  const [items, setItems] = useState<ScanWithUsage[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial loading
  useEffect(() => {
    const init = async () => {
      try {
        const sessionId = await window.api.getCurrentSessionId();
        const scans = await window.api.getSessionScans(sessionId);

        if (!scans || scans.length === 0) {
          setItems([]);
          return;
        }

        const sorted = [...scans].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const loaded: ScanWithUsage[] = await Promise.all(
          sorted.map(async (scan) => {
            const detail = await window.api.getPromptScanDetail(scan.request_id);
            return {
              scan,
              usage: detail?.usage ?? null,
            };
          })
        );

        setItems(loaded);
      } catch (err) {
        console.error('ContextAnalysisView init error:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Real-time updates
  useEffect(() => {
    const cleanup = window.api.onNewPromptScan(({ scan, usage }) => {
      setItems((prev) => [...prev, { scan: scan as PromptScan, usage: usage as UsageLogEntry }]);
    });
    return cleanup;
  }, []);

  // Aggregation
  const { summary, categories, files } = useMemo(() => aggregateData(items), [items]);

  if (loading) {
    return (
      <div className="ctx-view__loading">
        Loading...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="ctx-view__empty">
        <div className="ctx-view__empty-icon">
          {'( )'}
        </div>
        <div className="ctx-view__empty-title">
          No scan data yet
        </div>
        <div className="ctx-view__empty-hint">
          Send API requests through the proxy to start analysis
        </div>
      </div>
    );
  }

  return (
    <div className="ctx-view__root">
      {/* Summary cards */}
      <SummaryCards summary={summary} />

      {/* Category donut chart + legend */}
      <div className="ctx-view__section">
        <div className="ctx-view__section-title">
          Injection by Category
        </div>
        <CategoryDonutChart data={categories} totalTokens={summary.totalInjectedTokens} />
      </div>

      {/* Cumulative token ranking by file */}
      <div className="ctx-view__section--ranking">
        <div className="ctx-view__section-title--ranking">
          File Token Ranking
        </div>
        <FileRankingTable files={files} />
      </div>
    </div>
  );
};
