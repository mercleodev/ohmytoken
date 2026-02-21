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
    <div style={{
      background: 'rgba(15, 23, 42, 0.95)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 8,
      padding: '10px 14px',
      color: '#fff',
      fontSize: 12,
      maxWidth: 300,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {scan.user_prompt.slice(0, 80) || '(system)'}
      </div>
      <div style={{ color: '#94a3b8', marginBottom: 6 }}>
        {formatTime(scan.timestamp)} | {scan.model.split('-').slice(-2).join('-')}
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
        <span>Cost: {formatCost(entry.cost)}</span>
        <span>Tools: {scan.tool_calls.length}</span>
        <span>Files: {scan.injected_files.length}</span>
      </div>
      {total > 0 && (
        <div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
            Context: {total.toLocaleString()} tokens
          </div>
          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.1)' }}>
            <div style={{ width: `${(ctx.system_tokens / total) * 100}%`, background: '#8b5cf6' }} title="System" />
            <div style={{ width: `${(ctx.messages_tokens / total) * 100}%`, background: '#3b82f6' }} title="Messages" />
            <div style={{ width: `${(ctx.tools_definition_tokens / total) * 100}%`, background: '#f59e0b' }} title="Tools" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 9, color: '#94a3b8' }}>
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
      <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>No scan data yet</div>
        <div style={{ fontSize: 12 }}>
          Start the proxy server and make API requests to see CT scan data.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          {entries.length} requests | Total: {formatCost(entries.reduce((s, e) => s + e.cost, 0))}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
          <span style={{ color: '#8b5cf6' }}>Opus</span>
          <span style={{ color: '#3b82f6' }}>Sonnet</span>
          <span style={{ color: '#10b981' }}>Haiku</span>
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
