import { getDatabase } from "./index";
import type {
  PromptScan,
  ScanStats,
  UsageLogEntry,
  InjectedFile,
  ToolCall,
  AgentCall,
} from "../proxy/types";

// --- Query types ---

type PromptQueryOptions = {
  limit?: number;
  offset?: number;
  session_id?: string;
  date?: string; // 'YYYY-MM-DD'
  model?: string;
  source?: "proxy" | "history" | "file-scan";
  provider?: string; // "claude" | "codex" | "gemini" — omit for all
};

type PromptDbRow = {
  id: number;
  request_id: string;
  session_id: string;
  timestamp: string;
  source: string;
  user_prompt: string | null;
  user_prompt_tokens: number;
  assistant_response: string | null;
  model: string;
  max_tokens: number;
  conversation_turns: number;
  user_messages_count: number;
  assistant_messages_count: number;
  tool_result_count: number;
  system_tokens: number;
  messages_tokens: number;
  user_text_tokens: number;
  assistant_tokens: number;
  tool_result_tokens: number;
  tools_definition_tokens: number;
  total_context_tokens: number;
  total_injected_tokens: number;
  tool_summary: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
  duration_ms: number;
  req_messages_count: number;
  req_tools_count: number;
  req_has_system: number;
  provider: string;
  git_branch: string | null;
};

type InjectedFileDbRow = {
  path: string;
  category: string;
  estimated_tokens: number;
};

type ToolCallDbRow = {
  call_index: number;
  name: string;
  input_summary: string | null;
  timestamp: string | null;
};

type AgentCallDbRow = {
  call_index: number;
  subagent_type: string | null;
  description: string | null;
};

// --- Row → PromptScan conversion ---

const rowToPromptScan = (
  row: PromptDbRow,
  injectedFiles: InjectedFile[],
  toolCalls: ToolCall[],
  agentCalls: AgentCall[],
): PromptScan => ({
  request_id: row.request_id,
  session_id: row.session_id,
  timestamp: row.timestamp,
  user_prompt: row.user_prompt ?? "",
  user_prompt_tokens: row.user_prompt_tokens,
  assistant_response: row.assistant_response ?? undefined,
  injected_files: injectedFiles,
  total_injected_tokens: row.total_injected_tokens,
  tool_calls: toolCalls,
  tool_summary: JSON.parse(row.tool_summary || "{}"),
  agent_calls: agentCalls,
  context_estimate: {
    system_tokens: row.system_tokens,
    messages_tokens: row.messages_tokens,
    messages_tokens_breakdown: {
      user_text_tokens: row.user_text_tokens,
      assistant_tokens: row.assistant_tokens,
      tool_result_tokens: row.tool_result_tokens,
    },
    tools_definition_tokens: row.tools_definition_tokens,
    total_tokens: row.total_context_tokens,
  },
  model: row.model,
  max_tokens: row.max_tokens,
  conversation_turns: row.conversation_turns,
  user_messages_count: row.user_messages_count,
  assistant_messages_count: row.assistant_messages_count,
  tool_result_count: row.tool_result_count,
  provider: row.provider ?? 'claude',
  git_branch: row.git_branch ?? undefined,
});

const rowToUsageLogEntry = (row: PromptDbRow): UsageLogEntry => ({
  timestamp: row.timestamp,
  request_id: row.request_id,
  session_id: row.session_id,
  model: row.model,
  request: {
    messages_count: row.req_messages_count,
    tools_count: row.req_tools_count,
    has_system: row.req_has_system === 1,
    max_tokens: row.max_tokens,
  },
  response: {
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_creation_input_tokens: row.cache_creation_input_tokens,
    cache_read_input_tokens: row.cache_read_input_tokens,
  },
  cost_usd: row.cost_usd,
  duration_ms: row.duration_ms,
});

// --- Public API ---

export const getPrompts = (options?: PromptQueryOptions): PromptScan[] => {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (options?.session_id) {
    conditions.push("session_id = @session_id");
    params.session_id = options.session_id;
  }
  if (options?.date) {
    conditions.push("substr(timestamp, 1, 10) = @date");
    params.date = options.date;
  }
  if (options?.model) {
    conditions.push("model = @model");
    params.model = options.model;
  }
  if (options?.source) {
    conditions.push("source = @source");
    params.source = options.source;
  }
  if (options?.provider) {
    conditions.push("provider = @provider");
    params.provider = options.provider;
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  // When filtering by session_id, apply dedup CTE to avoid duplicate prompts
  const useDedup = !!options?.session_id;
  const query = useDedup
    ? `
    WITH deduped AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY session_id, timestamp
        ORDER BY CASE source WHEN 'history' THEN 3 WHEN 'proxy' THEN 2 ELSE 1 END DESC
      ) as _rn
      FROM prompts ${where}
    )
    SELECT * FROM deduped WHERE _rn = 1
    ORDER BY timestamp DESC
    LIMIT @limit OFFSET @offset
  `
    : `
    SELECT * FROM prompts ${where}
    ORDER BY timestamp DESC
    LIMIT @limit OFFSET @offset
  `;

  const rows = db
    .prepare(query)
    .all({ ...params, limit, offset }) as PromptDbRow[];

  return rows.map((row) => {
    const files = db
      .prepare(
        "SELECT path, category, estimated_tokens FROM injected_files WHERE prompt_id = @pid",
      )
      .all({ pid: row.id }) as InjectedFileDbRow[];
    const tools = db
      .prepare(
        "SELECT call_index, name, input_summary, timestamp FROM tool_calls WHERE prompt_id = @pid ORDER BY call_index",
      )
      .all({ pid: row.id }) as ToolCallDbRow[];
    const agents = db
      .prepare(
        "SELECT call_index, subagent_type, description FROM agent_calls WHERE prompt_id = @pid ORDER BY call_index",
      )
      .all({ pid: row.id }) as AgentCallDbRow[];

    return rowToPromptScan(
      row,
      files.map((f) => ({
        path: f.path,
        category: f.category as InjectedFile["category"],
        estimated_tokens: f.estimated_tokens,
      })),
      tools.map((t) => ({
        index: t.call_index,
        name: t.name,
        input_summary: t.input_summary ?? "",
        timestamp: t.timestamp ?? undefined,
      })),
      agents.map((a) => ({
        index: a.call_index,
        subagent_type: a.subagent_type ?? "",
        description: a.description ?? "",
      })),
    );
  });
};

export const getPromptDetail = (
  requestId: string,
): { scan: PromptScan; usage: UsageLogEntry } | null => {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM prompts WHERE request_id = @request_id")
    .get({ request_id: requestId }) as PromptDbRow | undefined;

  if (!row) return null;

  const files = db
    .prepare(
      "SELECT path, category, estimated_tokens FROM injected_files WHERE prompt_id = @pid",
    )
    .all({ pid: row.id }) as InjectedFileDbRow[];
  const tools = db
    .prepare(
      "SELECT call_index, name, input_summary, timestamp FROM tool_calls WHERE prompt_id = @pid ORDER BY call_index",
    )
    .all({ pid: row.id }) as ToolCallDbRow[];
  const agents = db
    .prepare(
      "SELECT call_index, subagent_type, description FROM agent_calls WHERE prompt_id = @pid ORDER BY call_index",
    )
    .all({ pid: row.id }) as AgentCallDbRow[];

  return {
    scan: rowToPromptScan(
      row,
      files.map((f) => ({
        path: f.path,
        category: f.category as InjectedFile["category"],
        estimated_tokens: f.estimated_tokens,
      })),
      tools.map((t) => ({
        index: t.call_index,
        name: t.name,
        input_summary: t.input_summary ?? "",
        timestamp: t.timestamp ?? undefined,
      })),
      agents.map((a) => ({
        index: a.call_index,
        subagent_type: a.subagent_type ?? "",
        description: a.description ?? "",
      })),
    ),
    usage: rowToUsageLogEntry(row),
  };
};

export const getSessionPrompts = (sessionId: string): PromptScan[] =>
  getPrompts({ session_id: sessionId, limit: 500 });

export const getScanStats = (provider?: string, days?: number): ScanStats => {
  const db = getDatabase();
  const periodDays = days ?? 30;
  const providerFilter = provider ? "AND provider = ?" : "";
  const providerParams = provider ? [provider] : [];

  // Cost by period (grouped by local date)
  const costByPeriod = db
    .prepare(
      `
    SELECT substr(datetime(timestamp, 'localtime'), 1, 10) as period,
           SUM(cost_usd) as cost_usd, COUNT(*) as request_count
    FROM prompts
    WHERE timestamp >= date('now', 'localtime', '-${periodDays} days') ${providerFilter}
    GROUP BY substr(datetime(timestamp, 'localtime'), 1, 10)
    ORDER BY period
  `,
    )
    .all(...providerParams) as Array<{
    period: string;
    cost_usd: number;
    request_count: number;
  }>;

  // Cost by time (individual entries, last 500)
  const costByTime = db
    .prepare(
      `
    SELECT timestamp, model, cost_usd
    FROM prompts
    WHERE 1=1 ${providerFilter}
    ORDER BY timestamp DESC
    LIMIT 500
  `,
    )
    .all(...providerParams) as Array<{ timestamp: string; model: string; cost_usd: number }>;

  // Tool frequency (join with prompts for provider filter)
  const toolRows = provider
    ? (db
        .prepare(
          `
    SELECT tc.name, COUNT(*) as cnt
    FROM tool_calls tc
    JOIN prompts p ON tc.prompt_id = p.id
    WHERE p.provider = ?
    GROUP BY tc.name
    ORDER BY cnt DESC
  `,
        )
        .all(provider) as Array<{ name: string; cnt: number }>)
    : (db
        .prepare(
          `
    SELECT name, COUNT(*) as cnt
    FROM tool_calls
    GROUP BY name
    ORDER BY cnt DESC
  `,
        )
        .all() as Array<{ name: string; cnt: number }>);
  const toolFrequency: Record<string, number> = {};
  for (const t of toolRows) toolFrequency[t.name] = t.cnt;

  // Injected file tokens (join with prompts for provider filter)
  const injectedRows = provider
    ? (db
        .prepare(
          `
    SELECT inf.path, SUM(inf.estimated_tokens) as total_tokens
    FROM injected_files inf
    JOIN prompts p ON inf.prompt_id = p.id
    WHERE p.provider = ?
    GROUP BY inf.path
    ORDER BY total_tokens DESC
  `,
        )
        .all(provider) as Array<{ path: string; total_tokens: number }>)
    : (db
        .prepare(
          `
    SELECT path, SUM(estimated_tokens) as total_tokens
    FROM injected_files
    GROUP BY path
    ORDER BY total_tokens DESC
  `,
        )
        .all() as Array<{ path: string; total_tokens: number }>);
  const totalInjected = injectedRows.reduce((s, r) => s + r.total_tokens, 0);
  const injectedFileTokens = injectedRows.map((r) => ({
    path: r.path,
    total_tokens: r.total_tokens,
    percentage: totalInjected > 0 ? (r.total_tokens / totalInjected) * 100 : 0,
  }));

  // Cache hit rate (last 500 entries)
  const cacheRows = db
    .prepare(
      `
    SELECT timestamp,
      CASE WHEN (cache_read_input_tokens + cache_creation_input_tokens + input_tokens) > 0
        THEN CAST(cache_read_input_tokens AS REAL) / (cache_read_input_tokens + cache_creation_input_tokens + input_tokens) * 100
        ELSE 0
      END as hit_rate
    FROM prompts
    WHERE 1=1 ${providerFilter}
    ORDER BY timestamp DESC
    LIMIT 500
  `,
    )
    .all(...providerParams) as Array<{ timestamp: string; hit_rate: number }>;

  // Summary (scoped to period)
  const summaryRow = db
    .prepare(
      `
    SELECT
      COUNT(*) as total_requests,
      SUM(cost_usd) as total_cost_usd,
      AVG(total_context_tokens) as avg_context_tokens,
      CASE WHEN SUM(cache_read_input_tokens + cache_creation_input_tokens + input_tokens) > 0
        THEN CAST(SUM(cache_read_input_tokens) AS REAL) / SUM(cache_read_input_tokens + cache_creation_input_tokens + input_tokens) * 100
        ELSE 0
      END as cache_hit_rate
    FROM prompts
    WHERE timestamp >= date('now', 'localtime', '-${periodDays} days') ${providerFilter}
  `,
    )
    .get(...providerParams) as
    | {
        total_requests: number;
        total_cost_usd: number;
        avg_context_tokens: number;
        cache_hit_rate: number;
      }
    | undefined;

  const topTool = toolRows[0]?.name ?? "N/A";

  return {
    cost_by_time: costByTime,
    tool_frequency: toolFrequency,
    injected_file_tokens: injectedFileTokens,
    cache_hit_rate: cacheRows,
    cost_by_period: costByPeriod,
    summary: {
      total_requests: summaryRow?.total_requests ?? 0,
      total_cost_usd: summaryRow?.total_cost_usd ?? 0,
      avg_context_tokens: Math.round(summaryRow?.avg_context_tokens ?? 0),
      most_used_tool: topTool,
      cache_hit_rate: Math.round((summaryRow?.cache_hit_rate ?? 0) * 10) / 10,
    },
  };
};

type DailyStatsRow = {
  date: string;
  request_count: number;
  total_cost_usd: number;
  total_context_tokens: number;
  cache_hit_rate: number;
};

export const getDailyStats = (
  date?: string,
  provider?: string,
): DailyStatsRow[] => {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (date) {
    conditions.push("date = @date");
    params.date = date;
  }
  if (provider) {
    conditions.push("provider = @provider");
    params.provider = provider;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM daily_stats ${where} ORDER BY date DESC LIMIT 30`)
    .all(params) as DailyStatsRow[];
};

type SessionListRow = {
  session_id: string;
  first_timestamp: string;
  last_timestamp: string;
  prompt_count: number;
  total_cost_usd: number;
  total_context_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  project: string | null;
};

export const getSessionList = (
  limit = 20,
  provider?: string,
): SessionListRow[] => {
  const db = getDatabase();
  const where = provider ? "WHERE provider = @provider" : "";
  return db
    .prepare(
      `
    SELECT session_id, first_timestamp, last_timestamp, prompt_count, total_cost_usd, total_context_tokens,
           COALESCE(total_output_tokens, 0) as total_output_tokens,
           COALESCE(total_cache_read_tokens, 0) as total_cache_read_tokens,
           project
    FROM sessions
    ${where}
    ORDER BY last_timestamp DESC
    LIMIT @limit
  `,
    )
    .all({ limit, provider: provider ?? null }) as SessionListRow[];
};

// --- Token Output Productivity queries ---

type TokenCompositionRow = {
  cache_read: number;
  cache_create: number;
  input: number;
  output: number;
};

export type TokenCompositionResult = {
  cache_read: number;
  cache_create: number;
  input: number;
  output: number;
  total: number;
};

export const getTokenComposition = (
  period: 'today' | '7d' | '30d',
  provider?: string,
): TokenCompositionResult => {
  const db = getDatabase();
  const conditions: string[] = [];
  switch (period) {
    case 'today':
      conditions.push("substr(datetime(timestamp, 'localtime'), 1, 10) = date('now', 'localtime')");
      break;
    case '7d':
      conditions.push("timestamp >= date('now', 'localtime', '-7 days')");
      break;
    case '30d':
      conditions.push("timestamp >= date('now', 'localtime', '-30 days')");
      break;
  }
  if (provider) {
    conditions.push("provider = @provider");
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const row = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(cache_read_input_tokens), 0) as cache_read,
      COALESCE(SUM(cache_creation_input_tokens), 0) as cache_create,
      COALESCE(SUM(input_tokens), 0) as input,
      COALESCE(SUM(output_tokens), 0) as output
    FROM prompts
    ${whereClause}
  `,
    )
    .get({ provider: provider ?? null }) as TokenCompositionRow;

  const clamped = {
    cache_read: Math.max(0, row.cache_read),
    cache_create: Math.max(0, row.cache_create),
    input: Math.max(0, row.input),
    output: Math.max(0, row.output),
  };
  const total = clamped.cache_read + clamped.cache_create + clamped.input + clamped.output;
  return { ...clamped, total };
};

export type ProviderCostSummary = {
  todayCostUSD: number;
  todayTokens: number;
  last30DaysCostUSD: number;
  last30DaysTokens: number;
};

export const getProviderCostSummary = (provider?: string): ProviderCostSummary => {
  const db = getDatabase();
  const provFilter = provider ? " AND provider = @provider" : "";

  type CostRow = { total_cost: number; total_tokens: number };

  const todayRow = db
    .prepare(
      `
    SELECT COALESCE(SUM(cost_usd), 0) as total_cost,
           COALESCE(SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens), 0) as total_tokens
    FROM prompts
    WHERE substr(datetime(timestamp, 'localtime'), 1, 10) = date('now', 'localtime')${provFilter}
  `,
    )
    .get({ provider: provider ?? null }) as CostRow;

  const monthRow = db
    .prepare(
      `
    SELECT COALESCE(SUM(cost_usd), 0) as total_cost,
           COALESCE(SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens), 0) as total_tokens
    FROM prompts
    WHERE timestamp >= date('now', 'localtime', '-30 days')${provFilter}
  `,
    )
    .get({ provider: provider ?? null }) as CostRow;

  return {
    todayCostUSD: todayRow.total_cost,
    todayTokens: todayRow.total_tokens,
    last30DaysCostUSD: monthRow.total_cost,
    last30DaysTokens: monthRow.total_tokens,
  };
};

export type OutputProductivityResult = {
  todayOutputTokens: number;
  todayTotalTokens: number;
  todayOutputRatio: number;
  todayCostUSD: number;
  last7DaysOutputTokens: number;
  last7DaysTotalTokens: number;
  last7DaysOutputRatio: number;
};

export const getOutputProductivity = (provider?: string): OutputProductivityResult => {
  const db = getDatabase();

  type PeriodRow = {
    output_tokens: number;
    total_tokens: number;
    total_cost: number;
  };

  const provFilter = provider ? " AND provider = @provider" : "";

  const todayRow = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as total_cost
    FROM prompts
    WHERE substr(datetime(timestamp, 'localtime'), 1, 10) = date('now', 'localtime')${provFilter}
  `,
    )
    .get({ provider: provider ?? null }) as PeriodRow;

  const weekRow = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as total_cost
    FROM prompts
    WHERE timestamp >= date('now', 'localtime', '-7 days')${provFilter}
  `,
    )
    .get({ provider: provider ?? null }) as PeriodRow;

  const todayOutput = Math.max(0, todayRow.output_tokens);
  const todayTotal = Math.max(0, todayRow.total_tokens);
  const weekOutput = Math.max(0, weekRow.output_tokens);
  const weekTotal = Math.max(0, weekRow.total_tokens);

  return {
    todayOutputTokens: todayOutput,
    todayTotalTokens: todayTotal,
    todayOutputRatio: todayTotal > 0 ? todayOutput / todayTotal : 0,
    todayCostUSD: todayRow.total_cost,
    last7DaysOutputTokens: weekOutput,
    last7DaysTotalTokens: weekTotal,
    last7DaysOutputRatio: weekTotal > 0 ? weekOutput / weekTotal : 0,
  };
};

export type TurnMetric = {
  turnIndex: number;
  timestamp: string;
  cache_read_tokens: number;
  cache_create_tokens: number;
  input_tokens: number;
  output_tokens: number;
  total_context_tokens: number;
  cost_usd: number;
};

export const getSessionTurnMetrics = (
  sessionId: string,
): TurnMetric[] => {
  const db = getDatabase();

  type TurnRow = {
    turn_index: number;
    request_id: string;
    timestamp: string;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    input_tokens: number;
    output_tokens: number;
    total_context_tokens: number;
    cost_usd: number;
  };

  const continuationMarker =
    "This session is being continued from a previous conversation that ran out of context";

  const rows = db
    .prepare(
      `
    WITH deduped AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY session_id, timestamp
        ORDER BY CASE source WHEN 'history' THEN 3 WHEN 'proxy' THEN 2 ELSE 1 END DESC
      ) as _rn
      FROM prompts
      WHERE session_id = @session_id
        AND LOWER(model) NOT LIKE '%synthetic%'
        AND (user_prompt IS NULL OR user_prompt NOT LIKE @continuation_pattern)
        AND (total_context_tokens > 0 OR (user_prompt IS NOT NULL AND TRIM(user_prompt) != ''))
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY timestamp ASC) as turn_index,
      request_id,
      timestamp,
      cache_read_input_tokens,
      cache_creation_input_tokens,
      input_tokens,
      output_tokens,
      total_context_tokens,
      cost_usd
    FROM deduped
    WHERE _rn = 1
    ORDER BY timestamp ASC
  `,
    )
    .all({
      session_id: sessionId,
      continuation_pattern: `%${continuationMarker}%`,
    }) as TurnRow[];

  return rows.map((r) => ({
    turnIndex: r.turn_index,
    request_id: r.request_id,
    timestamp: r.timestamp,
    cache_read_tokens: Math.max(0, r.cache_read_input_tokens),
    cache_create_tokens: Math.max(0, r.cache_creation_input_tokens),
    input_tokens: Math.max(0, r.input_tokens),
    output_tokens: Math.max(0, r.output_tokens),
    total_context_tokens: r.total_context_tokens,
    cost_usd: r.cost_usd,
  }));
};

export const getPromptCount = (): number => {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as cnt FROM prompts").get() as {
    cnt: number;
  };
  return row.cnt;
};

// --- Evidence scoring queries ---

import type {
  EvidenceReport,
  FileEvidenceScore,
  SignalResult,
} from '../evidence/types';

import { isMcpTool } from '../utils/mcpTools';

type EvidenceReportRow = {
  id: number;
  prompt_id: number;
  request_id: string;
  timestamp: string;
  engine_version: string;
  fusion_method: string;
  confirmed_min: number;
  likely_min: number;
};

type FileEvidenceScoreRow = {
  id: number;
  report_id: number;
  file_path: string;
  category: string;
  raw_score: number;
  normalized_score: number;
  classification: string;
  signals_json: string;
};

export const getEvidenceReport = (requestId: string): EvidenceReport | null => {
  const db = getDatabase();

  const reportRow = db
    .prepare('SELECT * FROM evidence_reports WHERE request_id = @request_id')
    .get({ request_id: requestId }) as EvidenceReportRow | undefined;

  if (!reportRow) return null;

  const fileRows = db
    .prepare('SELECT * FROM file_evidence_scores WHERE report_id = @report_id')
    .all({ report_id: reportRow.id }) as FileEvidenceScoreRow[];

  const files: FileEvidenceScore[] = fileRows.map((r) => ({
    filePath: r.file_path,
    category: r.category,
    signals: JSON.parse(r.signals_json) as SignalResult[],
    rawScore: r.raw_score,
    normalizedScore: r.normalized_score,
    classification: r.classification as FileEvidenceScore['classification'],
  }));

  return {
    request_id: reportRow.request_id,
    timestamp: reportRow.timestamp,
    engine_version: reportRow.engine_version,
    fusion_method: reportRow.fusion_method,
    files,
    thresholds: {
      confirmed_min: reportRow.confirmed_min,
      likely_min: reportRow.likely_min,
    },
  };
};

/**
 * Get previous normalized scores for each file in a session.
 * Used by the session-history signal.
 */
export const getSessionFileScores = (
  sessionId: string,
): Record<string, number[]> => {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT fes.file_path, fes.normalized_score
      FROM file_evidence_scores fes
      JOIN evidence_reports er ON er.id = fes.report_id
      JOIN prompts p ON p.id = er.prompt_id
      WHERE p.session_id = @session_id
      ORDER BY p.timestamp ASC
    `)
    .all({ session_id: sessionId }) as Array<{
    file_path: string;
    normalized_score: number;
  }>;

  const result: Record<string, number[]> = {};
  for (const r of rows) {
    if (!result[r.file_path]) result[r.file_path] = [];
    result[r.file_path].push(r.normalized_score);
  }
  return result;
};

export const findPromptByTimestamp = (
  sessionId: string,
  timestampMs: number,
  toleranceMs = 30000,
): PromptScan | null => {
  const db = getDatabase();
  // Convert timestamp range to ISO strings for comparison
  const minTime = new Date(timestampMs - toleranceMs).toISOString();
  const maxTime = new Date(timestampMs + toleranceMs).toISOString();

  const row = db
    .prepare(
      `
    SELECT * FROM prompts
    WHERE session_id = @session_id AND timestamp >= @min_time AND timestamp <= @max_time
    ORDER BY ABS(julianday(timestamp) - julianday(@target_time))
    LIMIT 1
  `,
    )
    .get({
      session_id: sessionId,
      min_time: minTime,
      max_time: maxTime,
      target_time: new Date(timestampMs).toISOString(),
    }) as PromptDbRow | undefined;

  if (!row) return null;

  const files = db
    .prepare(
      "SELECT path, category, estimated_tokens FROM injected_files WHERE prompt_id = @pid",
    )
    .all({ pid: row.id }) as InjectedFileDbRow[];
  const tools = db
    .prepare(
      "SELECT call_index, name, input_summary, timestamp FROM tool_calls WHERE prompt_id = @pid ORDER BY call_index",
    )
    .all({ pid: row.id }) as ToolCallDbRow[];
  const agents = db
    .prepare(
      "SELECT call_index, subagent_type, description FROM agent_calls WHERE prompt_id = @pid ORDER BY call_index",
    )
    .all({ pid: row.id }) as AgentCallDbRow[];

  return rowToPromptScan(
    row,
    files.map((f) => ({
      path: f.path,
      category: f.category as InjectedFile["category"],
      estimated_tokens: f.estimated_tokens,
    })),
    tools.map((t) => ({
      index: t.call_index,
      name: t.name,
      input_summary: t.input_summary ?? "",
      timestamp: t.timestamp ?? undefined,
    })),
    agents.map((a) => ({
      index: a.call_index,
      subagent_type: a.subagent_type ?? "",
      description: a.description ?? "",
    })),
  );
};

// --- MCP Insights queries ---

type McpToolStat = {
  name: string;
  callCount: number;
  totalResultTokens: number;
};

type McpInsightsResult = {
  totalMcpCalls: number;
  totalToolCalls: number;
  mcpCallRatio: number;
  totalToolResultTokens: number;
  mcpToolStats: McpToolStat[];
  redundantCallCount: number;
};

export const getMcpInsights = (period: 'today' | '7d' | '30d', provider?: string): McpInsightsResult => {
  const db = getDatabase();
  const conditions: string[] = [];
  switch (period) {
    case 'today':
      conditions.push("substr(datetime(p.timestamp, 'localtime'), 1, 10) = date('now', 'localtime')");
      break;
    case '7d':
      conditions.push("p.timestamp >= date('now', 'localtime', '-7 days')");
      break;
    case '30d':
      conditions.push("p.timestamp >= date('now', 'localtime', '-30 days')");
      break;
  }
  if (provider) {
    conditions.push("p.provider = @provider");
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const params = provider ? { provider } : {};

  // 1. Tool call counts grouped by name
  const toolRows = db
    .prepare(`
      SELECT tc.name, COUNT(*) as cnt
      FROM tool_calls tc JOIN prompts p ON tc.prompt_id = p.id
      ${whereClause}
      GROUP BY tc.name ORDER BY cnt DESC
    `)
    .all(params) as Array<{ name: string; cnt: number }>;

  // 2. Total tool_result_tokens
  const totals = db
    .prepare(`
      SELECT
        COALESCE(SUM(p.tool_result_tokens), 0) as trt,
        COALESCE(SUM(p.tool_result_count), 0) as trc
      FROM prompts p
      ${whereClause}
    `)
    .get(params) as { trt: number; trc: number };

  // 3. Classify with isMcpTool()
  let totalToolCalls = 0;
  let totalMcpCalls = 0;
  const mcpToolStats: McpToolStat[] = [];

  for (const row of toolRows) {
    totalToolCalls += row.cnt;
    if (isMcpTool(row.name)) {
      totalMcpCalls += row.cnt;
      mcpToolStats.push({
        name: row.name,
        callCount: row.cnt,
        totalResultTokens: 0, // per-tool token breakdown not available in DB
      });
    }
  }

  // 4. Redundant call detection (same name+input_summary appearing 2+ times in same period)
  const redundantRows = db
    .prepare(`
      SELECT tc.name, tc.input_summary, COUNT(*) as cnt
      FROM tool_calls tc JOIN prompts p ON tc.prompt_id = p.id
      ${whereClause}
      GROUP BY tc.name, tc.input_summary
      HAVING cnt >= 2 AND tc.input_summary IS NOT NULL AND tc.input_summary != ''
    `)
    .all(params) as Array<{ name: string; input_summary: string; cnt: number }>;

  let redundantCallCount = 0;
  for (const r of redundantRows) {
    if (isMcpTool(r.name)) {
      redundantCallCount += r.cnt - 1; // count the duplicates (total - 1 original)
    }
  }

  return {
    totalMcpCalls,
    totalToolCalls,
    mcpCallRatio: totalToolCalls > 0 ? totalMcpCalls / totalToolCalls : 0,
    totalToolResultTokens: totals.trt,
    mcpToolStats,
    redundantCallCount,
  };
};

type RedundantPattern = {
  toolName: string;
  count: number;
  description: string;
};

type SessionMcpAnalysis = {
  totalToolCalls: number;
  mcpCalls: number;
  toolResultTokens: number;
  toolBreakdown: Record<string, number>;
  redundantPatterns: RedundantPattern[];
};

// --- Prompt Heatmap (GitHub-style activity graph) ---

export type HeatmapDay = {
  date: string;  // YYYY-MM-DD
  count: number;
};

export const getPromptHeatmap = (provider?: string): HeatmapDay[] => {
  const db = getDatabase();
  const providerFilter = provider ? "AND provider = @provider" : "";

  const rows = db
    .prepare(
      `
    SELECT substr(datetime(timestamp, 'localtime'), 1, 10) as date,
           COUNT(*) as count
    FROM prompts
    WHERE timestamp >= date('now', 'localtime', '-365 days') ${providerFilter}
    GROUP BY substr(datetime(timestamp, 'localtime'), 1, 10)
    ORDER BY date
  `,
    )
    .all({ provider: provider ?? null }) as HeatmapDay[];

  return rows;
};

export const getSessionMcpAnalysis = (sessionId: string): SessionMcpAnalysis => {
  const db = getDatabase();

  // 1. All tool_calls for the session
  const calls = db
    .prepare(`
      SELECT tc.name, tc.input_summary
      FROM tool_calls tc JOIN prompts p ON tc.prompt_id = p.id
      WHERE p.session_id = @session_id
      ORDER BY p.timestamp, tc.call_index
    `)
    .all({ session_id: sessionId }) as Array<{ name: string; input_summary: string | null }>;

  // 2. tool_result_tokens sum
  const tokenRow = db
    .prepare(`
      SELECT COALESCE(SUM(tool_result_tokens), 0) as trt
      FROM prompts WHERE session_id = @session_id
    `)
    .get({ session_id: sessionId }) as { trt: number };

  // 3. Classify and build breakdown
  const toolBreakdown: Record<string, number> = {};
  let mcpCalls = 0;

  for (const call of calls) {
    toolBreakdown[call.name] = (toolBreakdown[call.name] ?? 0) + 1;
    if (isMcpTool(call.name)) {
      mcpCalls++;
    }
  }

  // 4. Redundant pattern detection: same (name + input_summary) appearing 2+ times
  const signatureCount = new Map<string, { name: string; input: string; count: number }>();
  for (const call of calls) {
    if (!isMcpTool(call.name)) continue;
    const input = (call.input_summary ?? '').trim();
    if (!input) continue;
    const key = `${call.name}::${input}`;
    const entry = signatureCount.get(key);
    if (entry) {
      entry.count++;
    } else {
      signatureCount.set(key, { name: call.name, input, count: 1 });
    }
  }

  const redundantPatterns: RedundantPattern[] = [];
  for (const entry of signatureCount.values()) {
    if (entry.count >= 2) {
      redundantPatterns.push({
        toolName: entry.name,
        count: entry.count,
        description: entry.input.slice(0, 80),
      });
    }
  }

  return {
    totalToolCalls: calls.length,
    mcpCalls,
    toolResultTokens: tokenRow.trt,
    toolBreakdown,
    redundantPatterns,
  };
};

// --- Harness Candidate Detection (Workflow Change Recommendations) ---

type HarnessCandidateKind =
  | 'script'
  | 'cdp'
  | 'prompt_template'
  | 'checklist'
  | 'unknown';

type HarnessCandidate = {
  toolName: string;
  inputSummary: string;
  signature: string;
  provider: string;
  repeatCount: number;
  promptCount: number;
  sessionCount: number;
  firstSeen: string;
  lastSeen: string;
  totalCostUsd: number;
  totalToolResultTokens: number;
  isMcp: boolean;
  candidateKind: HarnessCandidateKind;
  confidence: number;
  score: number;
  reason: string;
  suggestedAction: string;
  sampleRequestIds?: string[];
};

type HarnessCandidateQuery = {
  sessionId?: string;
  provider?: string;
  period?: 'today' | '7d' | '30d';
  limit?: number;
};

// --- Classification helpers ---

const SCRIPT_TOOLS = new Set([
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
]);

const CDP_TOOL_PATTERNS = [
  'mcp__playwright',
  'playwright_',
  'browser_',
  'screenshot',
];

function classifyCandidateKind(toolName: string): HarnessCandidateKind {
  if (SCRIPT_TOOLS.has(toolName)) return 'script';

  const lower = toolName.toLowerCase();
  if (lower.includes('exec_command')) return 'script';

  for (const pattern of CDP_TOOL_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) return 'cdp';
  }

  return 'unknown';
}

function scoreCandidate(
  repeatCount: number,
  promptCount: number,
  sessionCount: number,
  totalCostUsd: number,
): number {
  return (
    repeatCount * 2 +
    sessionCount * 5 +
    promptCount +
    Math.min(totalCostUsd * 10, 50)
  );
}

function computeConfidence(
  repeatCount: number,
  promptCount: number,
  sessionCount: number,
  totalCostUsd: number,
  kind: HarnessCandidateKind,
): number {
  let conf = 0;
  if (repeatCount >= 5) conf += 0.3;
  else if (repeatCount >= 3) conf += 0.2;
  else conf += 0.1;

  if (sessionCount >= 3) conf += 0.3;
  else if (sessionCount >= 2) conf += 0.2;

  if (promptCount >= 5) conf += 0.2;
  else if (promptCount >= 3) conf += 0.15;
  else conf += 0.05;

  if (totalCostUsd >= 1.0) conf += 0.2;
  else if (totalCostUsd >= 0.1) conf += 0.1;

  if (kind === 'unknown') conf *= 0.5;

  return Math.min(1.0, conf);
}

/** Map internal tool names to user-friendly display names */
function friendlyToolName(toolName: string): string {
  if (toolName === 'exec_command') return 'Shell';
  if (toolName.startsWith('mcp__playwright__')) {
    return toolName.replace('mcp__playwright__', '').replace(/_/g, ' ');
  }
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    return parts.length >= 3 ? `${parts[1]}: ${parts[2]}` : parts[1] ?? toolName;
  }
  return toolName;
}

/** Generate a slug from input summary for file path suggestions */
function inputToSlug(input: string): string {
  return input
    .split(/[\s/\\]+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'untitled';
}

function buildReason(
  kind: HarnessCandidateKind,
  toolName: string,
  inputSummary: string,
  repeatCount: number,
  sessionCount: number,
): string {
  const friendly = friendlyToolName(toolName);
  const cmd = inputSummary.length > 50 ? inputSummary.slice(0, 47) + '...' : inputSummary;

  switch (kind) {
    case 'script':
      return `"${cmd}" ran ${repeatCount}x across ${sessionCount} session(s). Extract to a reusable script.`;
    case 'cdp':
      return `"${friendly}" repeated ${repeatCount}x. Move into browser automation.`;
    case 'prompt_template':
      return `"${cmd}" repeats with varying targets. Turn into a reusable command.`;
    case 'checklist':
      return `This diagnostic flow repeated ${repeatCount}x across ${sessionCount} session(s). Save as a checklist.`;
    default:
      return `"${friendly}: ${cmd}" repeated ${repeatCount}x across ${sessionCount} session(s).`;
  }
}

function buildSuggestedAction(kind: HarnessCandidateKind, inputSummary: string): string {
  const slug = inputToSlug(inputSummary);
  switch (kind) {
    case 'script':
      return `Extract into scripts/${slug}.sh`;
    case 'cdp':
      return `Extract into automation/${slug}.md`;
    case 'prompt_template':
      return `Extract into .claude/commands/${slug}.md`;
    case 'checklist':
      return `Extract into .claude/checklists/${slug}.md`;
    default:
      return 'Review for potential reuse';
  }
}

// --- Main reader function ---

type CandidateDbRow = {
  tool_name: string;
  input_summary: string;
  repeat_count: number;
  prompt_count: number;
  session_count: number;
  providers: string;
  first_seen: string;
  last_seen: string;
  total_cost_usd: number;
  total_tool_result_tokens: number;
  sample_request_ids: string | null;
};

export const getHarnessCandidates = (query: HarnessCandidateQuery = {}): HarnessCandidate[] => {
  const db = getDatabase();
  const { sessionId, provider, period, limit = 20 } = query;

  // Build dynamic WHERE conditions
  const conditions: string[] = [
    "tc.input_summary IS NOT NULL",
    "tc.input_summary != ''",
  ];
  const params: Record<string, string | number> = { limit };

  if (sessionId) {
    conditions.push("p.session_id = @sessionId");
    params.sessionId = sessionId;
  }
  if (provider) {
    conditions.push("p.provider = @provider");
    params.provider = provider;
  }
  if (period) {
    switch (period) {
      case 'today':
        conditions.push("substr(datetime(p.timestamp, 'localtime'), 1, 10) = date('now', 'localtime')");
        break;
      case '7d':
        conditions.push("p.timestamp >= date('now', 'localtime', '-7 days')");
        break;
      case '30d':
        conditions.push("p.timestamp >= date('now', 'localtime', '-30 days')");
        break;
    }
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const rows = db
    .prepare(`
      WITH sig_prompts AS (
        SELECT DISTINCT
          tc.name AS tool_name,
          tc.input_summary,
          p.id AS prompt_id,
          p.request_id,
          p.session_id,
          p.provider,
          p.timestamp,
          p.cost_usd,
          p.tool_result_tokens
        FROM tool_calls tc
        JOIN prompts p ON tc.prompt_id = p.id
        ${whereClause}
      ),
      candidates AS (
        SELECT
          tool_name,
          input_summary,
          COUNT(*) AS repeat_count,
          COUNT(DISTINCT prompt_id) AS prompt_count,
          COUNT(DISTINCT session_id) AS session_count,
          GROUP_CONCAT(DISTINCT provider) AS providers,
          MIN(timestamp) AS first_seen,
          MAX(timestamp) AS last_seen,
          SUM(cost_usd) AS total_cost_usd,
          SUM(tool_result_tokens) AS total_tool_result_tokens
        FROM sig_prompts
        GROUP BY tool_name, input_summary
        HAVING COUNT(*) >= 2
      ),
      with_samples AS (
        SELECT
          c.*,
          (
            SELECT GROUP_CONCAT(sp.request_id)
            FROM (
              SELECT DISTINCT request_id
              FROM sig_prompts sp2
              WHERE sp2.tool_name = c.tool_name
                AND sp2.input_summary = c.input_summary
              LIMIT 3
            ) sp
          ) AS sample_request_ids
        FROM candidates c
      )
      SELECT * FROM with_samples
      ORDER BY repeat_count DESC
      LIMIT @limit
    `)
    .all(params) as CandidateDbRow[];

  return rows.map((row): HarnessCandidate => {
    const mcp = isMcpTool(row.tool_name);
    const kind = classifyCandidateKind(row.tool_name);
    const score = scoreCandidate(
      row.repeat_count,
      row.prompt_count,
      row.session_count,
      row.total_cost_usd,
    );
    const confidence = computeConfidence(
      row.repeat_count,
      row.prompt_count,
      row.session_count,
      row.total_cost_usd,
      kind,
    );

    return {
      toolName: row.tool_name,
      inputSummary: row.input_summary,
      signature: `${row.tool_name}::${row.input_summary.trim()}`,
      provider: row.providers ?? '',
      repeatCount: row.repeat_count,
      promptCount: row.prompt_count,
      sessionCount: row.session_count,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      totalCostUsd: row.total_cost_usd,
      totalToolResultTokens: row.total_tool_result_tokens,
      isMcp: mcp,
      candidateKind: kind,
      confidence,
      score,
      reason: buildReason(kind, row.tool_name, row.input_summary, row.repeat_count, row.session_count),
      suggestedAction: buildSuggestedAction(kind, row.input_summary),
      sampleRequestIds: row.sample_request_ids
        ? row.sample_request_ids.split(',').filter(Boolean)
        : undefined,
    };
  });
};
