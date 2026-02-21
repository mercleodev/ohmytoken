import { useState, useEffect, useMemo } from 'react';
import { CATEGORY_COLORS } from '../scan/shared';
import { SummaryCards } from './SummaryCards';
import { CategoryDonutChart } from './CategoryDonutChart';
import { FileRankingTable } from './FileRankingTable';
import type { PromptScan, UsageLogEntry } from '../../types/electron.d';

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
      <div style={{ padding: 24, textAlign: 'center', color: '#8e8e93', fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>
          {/* magnifying glass icon via text */}
          {'( )'}
        </div>
        <div style={{ fontSize: 13, color: '#8e8e93' }}>
          No scan data yet
        </div>
        <div style={{ fontSize: 11, color: '#c7c7cc', marginTop: 4 }}>
          Send API requests through the proxy to start analysis
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 0 16px' }}>
      {/* Summary cards */}
      <SummaryCards summary={summary} />

      {/* Category donut chart + legend */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 0 }}>
          Injection by Category
        </div>
        <CategoryDonutChart data={categories} totalTokens={summary.totalInjectedTokens} />
      </div>

      {/* Cumulative token ranking by file */}
      <div style={{ padding: '8px 16px 0' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
          File Token Ranking
        </div>
        <FileRankingTable files={files} />
      </div>
    </div>
  );
};
