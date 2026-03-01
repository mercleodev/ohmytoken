// CT Scan common utilities
// Generic formatters re-exported from shared utils
export { formatCost, formatTokens, formatTimeAgo } from '../../utils/format';

export const getModelShort = (model: string): string => {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('o4-mini')) return 'o4-mini';
  if (model.includes('o3')) return 'o3';
  if (model.includes('gemini')) {
    const m = model.match(/gemini-(\d+\.\d+)-(\w+)/);
    if (m) return `${m[1]} ${m[2].charAt(0).toUpperCase() + m[2].slice(1)}`;
  }
  return model.split('-').pop() || model;
};

export const getModelColor = (model: string): string => {
  if (model.includes('opus')) return '#8b5cf6';
  if (model.includes('sonnet')) return '#3b82f6';
  if (model.includes('haiku')) return '#10b981';
  if (model.includes('o4-mini') || model.includes('o3')) return '#f97316';
  if (model.includes('gemini')) return '#4285f4';
  return '#6b7280';
};

export const CATEGORY_COLORS: Record<string, string> = {
  global: '#8b5cf6',
  project: '#3b82f6',
  rules: '#f59e0b',
  memory: '#10b981',
  skill: '#ec4899',
};

// Claude Code operational context limits (not raw model limits)
// All models use 200K context window in Claude Code (Pro plan)
// Max plan users: override via Settings → Context Limit
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'o4-mini': 200_000,
  'o3': 258_400,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
};

const DEFAULT_CONTEXT_LIMIT = 200_000;

// Plan → context limit mapping (Claude Code operational limits)
export const PLAN_CONTEXT_LIMITS: Record<string, number> = {
  'Pro': 200_000,
  'Max': 200_000,
  'Team': 200_000,
  'Enterprise': 200_000,
  'Free': 200_000,
};

// Context limit presets for Settings UI
export const CONTEXT_LIMIT_PRESETS = [
  { label: 'Auto (from plan)', value: 0 },
  { label: '200K (Pro)', value: 200_000 },
  { label: '500K', value: 500_000 },
  { label: '1M (Max/Enterprise)', value: 1_000_000 },
] as const;

// Module-level override: set once on app startup from settings
let _contextLimitOverride = 0;

export const setContextLimitOverride = (v: number) => {
  _contextLimitOverride = v;
};

export const getContextLimitOverride = () => _contextLimitOverride;

export const getContextLimit = (model: string): number => {
  if (_contextLimitOverride > 0) return _contextLimitOverride;
  if (MODEL_CONTEXT_LIMITS[model]) return MODEL_CONTEXT_LIMITS[model];
  return DEFAULT_CONTEXT_LIMIT;
};

// Action (tool call) colors and helpers
export const ACTION_COLORS: Record<string, string> = {
  // File operations
  Read: '#3b82f6',
  Write: '#f59e0b',
  Edit: '#f59e0b',
  Glob: '#8b5cf6',
  Grep: '#8b5cf6',
  // Shell & execution
  Bash: '#10b981',
  Task: '#6366f1',
  // Web
  WebFetch: '#ec4899',
  WebSearch: '#ec4899',
  // Planning & workflow
  EnterPlanMode: '#0ea5e9',
  ExitPlanMode: '#0ea5e9',
  AskUserQuestion: '#14b8a6',
  // Notebook
  NotebookEdit: '#f97316',
  // Todo & task management
  TodoRead: '#a855f7',
  TodoWrite: '#a855f7',
  TaskCreate: '#6366f1',
  TaskUpdate: '#6366f1',
  TaskGet: '#6366f1',
  TaskList: '#6366f1',
  // Skills & MCP
  Skill: '#06b6d4',
  ListMcpResourcesTool: '#84cc16',
  ReadMcpResourceTool: '#84cc16',
  // Worktree
  EnterWorktree: '#78716c',
};

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);

export const formatActionDetail = (t: { name: string; input_summary: string }): string => {
  const s = t.input_summary;
  if (!s) return '';
  if (FILE_TOOLS.has(t.name) && s.startsWith('/')) {
    const parts = s.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : s;
  }
  if (t.name === 'Bash') return s.length > 60 ? s.slice(0, 60) + '...' : s;
  return s.length > 80 ? s.slice(0, 80) + '...' : s;
};

export const formatActionTime = (ts: string | undefined): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};

export const getGaugeColor = (pct: number): string => {
  if (pct < 40) return '#10b981';
  if (pct < 65) return '#f59e0b';
  if (pct < 85) return '#f97316';
  return '#ef4444';
};
