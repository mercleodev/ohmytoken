import { useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { formatCost, getModelColor } from './shared';
import type { PromptScan, UsageLogEntry } from '../../types';
import './scan.css';

type TimelineEntry = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  label: string;
  cost: number;
};

type MessageItem = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

type PromptTimelineProps = {
  entries: MessageItem[];
  onSelectScan: (scan: PromptScan, usage: UsageLogEntry | null) => void;
};

const formatTime = (ts: string): string => {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: TimelineEntry }>;
};

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  const { scan } = entry;
  const ctx = scan.context_estimate;
  const total = ctx.total_tokens;

  return (
    <div className="scan-tooltip">
      <div className="scan-tooltip__title">
        {scan.user_prompt.slice(0, 80) || '(system)'}
      </div>
      <div className="scan-tooltip__meta">
        {formatTime(scan.timestamp)} | {scan.model.split('-').slice(-2).join('-')}
      </div>
      <div className="scan-tooltip__stats">
        <span>Cost: {formatCost(entry.cost)}</span>
        <span>Tools: {scan.tool_calls.length}</span>
        <span>Files: {scan.injected_files.length}</span>
      </div>
      {total > 0 && (
        <div>
          <div className="scan-tooltip__context-label">
            Context: {total.toLocaleString()} tokens
          </div>
          <div className="scan-tooltip__context-bar">
            <div style={{ width: `${(ctx.system_tokens / total) * 100}%`, background: '#8b5cf6' }} title="System" />
            <div style={{ width: `${(ctx.messages_tokens / total) * 100}%`, background: '#3b82f6' }} title="Messages" />
            <div style={{ width: `${(ctx.tools_definition_tokens / total) * 100}%`, background: '#f59e0b' }} title="Tools" />
          </div>
          <div className="scan-tooltip__context-legend">
            <span>System {((ctx.system_tokens / total) * 100).toFixed(0)}%</span>
            <span>Msgs {((ctx.messages_tokens / total) * 100).toFixed(0)}%</span>
            <span>Tools {((ctx.tools_definition_tokens / total) * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const PromptTimeline = ({ entries: rawEntries, onSelectScan }: PromptTimelineProps) => {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Convert rawEntries to TimelineEntry (chronological — already sorted by parent)
  const entries: TimelineEntry[] = rawEntries.map((item) => ({
    scan: item.scan,
    usage: item.usage,
    label: formatTime(item.scan.timestamp),
    cost: item.usage?.cost_usd ?? 0,
  }));

  const handleBarClick = useCallback((_data: unknown, index: number) => {
    const entry = entries[index];
    if (entry) {
      setSelectedIdx(index);
      onSelectScan(entry.scan, entry.usage);
    }
  }, [entries, onSelectScan]);

  if (entries.length === 0) {
    return (
      <div className="scan-timeline__empty">
        <div className="scan-timeline__empty-title">No scan data yet</div>
        <div className="scan-timeline__empty-desc">
          Start the proxy server and make API requests to see CT scan data.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="scan-timeline__header">
        <div className="scan-timeline__summary">
          {entries.length} requests | Total: {formatCost(entries.reduce((s, e) => s + e.cost, 0))}
        </div>
        <div className="scan-timeline__legend">
          <span className="scan-timeline__legend-opus">Opus</span>
          <span className="scan-timeline__legend-sonnet">Sonnet</span>
          <span className="scan-timeline__legend-haiku">Haiku</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={entries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatCost(v)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar
            dataKey="cost"
            radius={[3, 3, 0, 0]}
            onClick={handleBarClick}
            style={{ cursor: 'pointer' }}
          >
            {entries.map((entry, idx) => (
              <Cell
                key={entry.scan.request_id}
                fill={getModelColor(entry.scan.model)}
                opacity={selectedIdx === idx ? 1 : 0.7}
                stroke={selectedIdx === idx ? '#fff' : 'none'}
                strokeWidth={selectedIdx === idx ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export type { PromptScan, UsageLogEntry };
