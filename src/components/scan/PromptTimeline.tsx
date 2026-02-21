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
import './scan.css';

// Matches the window.api return type
type PromptScanData = {
  request_id: string;
  session_id: string;
  timestamp: string;
  user_prompt: string;
  user_prompt_tokens: number;
  injected_files: Array<{ path: string; category: string; estimated_tokens: number }>;
  total_injected_tokens: number;
  tool_calls: Array<{ index: number; name: string; input_summary: string; timestamp?: string }>;
  tool_summary: Record<string, number>;
  agent_calls: Array<{ index: number; subagent_type: string; description: string }>;
  context_estimate: {
    system_tokens: number;
    messages_tokens: number;
    messages_tokens_breakdown?: {
      user_text_tokens: number;
      assistant_tokens: number;
      tool_result_tokens: number;
    };
    tools_definition_tokens: number;
    total_tokens: number;
  };
  model: string;
  max_tokens: number;
  conversation_turns: number;
  user_messages_count: number;
  assistant_messages_count: number;
  tool_result_count: number;
};

type UsageData = {
  timestamp: string;
  request_id: string;
  session_id: string;
  model: string;
  request: { messages_count: number; tools_count: number; has_system: boolean; max_tokens: number };
  response: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
  cost_usd: number;
  duration_ms: number;
};

type TimelineEntry = {
  scan: PromptScanData;
  usage: UsageData | null;
  label: string;
  cost: number;
};

type MessageItem = {
  scan: PromptScanData;
  usage: UsageData | null;
};

type PromptTimelineProps = {
  entries: MessageItem[];
  onSelectScan: (scan: PromptScanData, usage: UsageData | null) => void;
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
    <div className="timeline-tooltip">
      <div className="timeline-tooltip-title">
        {scan.user_prompt.slice(0, 80) || '(system)'}
      </div>
      <div className="timeline-tooltip-meta">
        {formatTime(scan.timestamp)} | {scan.model.split('-').slice(-2).join('-')}
      </div>
      <div className="timeline-tooltip-stats">
        <span>Cost: {formatCost(entry.cost)}</span>
        <span>Tools: {scan.tool_calls.length}</span>
        <span>Files: {scan.injected_files.length}</span>
      </div>
      {total > 0 && (
        <div>
          <div className="timeline-tooltip-ctx-label">
            Context: {total.toLocaleString()} tokens
          </div>
          <div className="timeline-tooltip-bar">
            <div style={{ width: `${(ctx.system_tokens / total) * 100}%`, background: '#8b5cf6' }} title="System" />
            <div style={{ width: `${(ctx.messages_tokens / total) * 100}%`, background: '#3b82f6' }} title="Messages" />
            <div style={{ width: `${(ctx.tools_definition_tokens / total) * 100}%`, background: '#f59e0b' }} title="Tools" />
          </div>
          <div className="timeline-tooltip-legend">
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
      <div className="prompt-timeline-empty">
        <div className="prompt-timeline-empty-title">No scan data yet</div>
        <div className="prompt-timeline-empty-desc">
          Start the proxy server and make API requests to see CT scan data.
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-timeline">
      <div className="prompt-timeline-header">
        <div className="prompt-timeline-summary">
          {entries.length} requests | Total: {formatCost(entries.reduce((s, e) => s + e.cost, 0))}
        </div>
        <div className="prompt-timeline-legend">
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

export type { PromptScanData, UsageData };
