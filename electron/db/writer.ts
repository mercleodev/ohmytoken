import type Database from "better-sqlite3";
import { getDatabase } from "./index";

export type PromptRow = {
  request_id: string;
  session_id: string;
  timestamp: string;
  source: "proxy" | "history" | "file-scan";
  provider?: string; // "claude" | "codex" | "gemini" — defaults to "claude"
  user_prompt?: string;
  user_prompt_tokens?: number;
  assistant_response?: string;
  model: string;
  max_tokens?: number;
  conversation_turns?: number;
  user_messages_count?: number;
  assistant_messages_count?: number;
  tool_result_count?: number;
  system_tokens?: number;
  messages_tokens?: number;
  user_text_tokens?: number;
  assistant_tokens?: number;
  tool_result_tokens?: number;
  tools_definition_tokens?: number;
  total_context_tokens?: number;
  total_injected_tokens?: number;
  tool_summary?: Record<string, number>;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  req_messages_count?: number;
  req_tools_count?: number;
  req_has_system?: boolean;
};

export type InjectedFileRow = {
  path: string;
  category: string;
  estimated_tokens: number;
};

export type ToolCallRow = {
  call_index: number;
  name: string;
  input_summary?: string;
  timestamp?: string;
};

export type AgentCallRow = {
  call_index: number;
  subagent_type?: string;
  description?: string;
};

export type InsertPromptData = {
  prompt: PromptRow;
  injected_files?: InjectedFileRow[];
  tool_calls?: ToolCallRow[];
  agent_calls?: AgentCallRow[];
};

// Cached prepared statements
let stmtCache: {
  insertPrompt?: Database.Statement;
  insertInjectedFile?: Database.Statement;
  insertToolCall?: Database.Statement;
  insertAgentCall?: Database.Statement;
  upsertDailyStats?: Database.Statement;
  upsertSession?: Database.Statement;
} = {};

const getStatements = () => {
  const db = getDatabase();

  if (!stmtCache.insertPrompt) {
    stmtCache.insertPrompt = db.prepare(`
      INSERT OR IGNORE INTO prompts (
        request_id, session_id, timestamp, source, provider,
        user_prompt, user_prompt_tokens, assistant_response,
        model, max_tokens,
        conversation_turns, user_messages_count, assistant_messages_count, tool_result_count,
        system_tokens, messages_tokens, user_text_tokens, assistant_tokens, tool_result_tokens,
        tools_definition_tokens, total_context_tokens, total_injected_tokens,
        tool_summary,
        input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
        cost_usd, duration_ms,
        req_messages_count, req_tools_count, req_has_system
      ) VALUES (
        @request_id, @session_id, @timestamp, @source, @provider,
        @user_prompt, @user_prompt_tokens, @assistant_response,
        @model, @max_tokens,
        @conversation_turns, @user_messages_count, @assistant_messages_count, @tool_result_count,
        @system_tokens, @messages_tokens, @user_text_tokens, @assistant_tokens, @tool_result_tokens,
        @tools_definition_tokens, @total_context_tokens, @total_injected_tokens,
        @tool_summary,
        @input_tokens, @output_tokens, @cache_creation_input_tokens, @cache_read_input_tokens,
        @cost_usd, @duration_ms,
        @req_messages_count, @req_tools_count, @req_has_system
      )
    `);

    stmtCache.insertInjectedFile = db.prepare(`
      INSERT INTO injected_files (prompt_id, path, category, estimated_tokens)
      VALUES (@prompt_id, @path, @category, @estimated_tokens)
    `);

    stmtCache.insertToolCall = db.prepare(`
      INSERT INTO tool_calls (prompt_id, call_index, name, input_summary, timestamp)
      VALUES (@prompt_id, @call_index, @name, @input_summary, @timestamp)
    `);

    stmtCache.insertAgentCall = db.prepare(`
      INSERT INTO agent_calls (prompt_id, call_index, subagent_type, description)
      VALUES (@prompt_id, @call_index, @subagent_type, @description)
    `);
  }

  return stmtCache as Required<typeof stmtCache>;
};

export type InsertPromptOptions = {
  skipAggregates?: boolean; // batch import: skip per-row upsertDailyStats/upsertSession
};

export const insertPrompt = (
  data: InsertPromptData,
  options?: InsertPromptOptions,
): number | null => {
  const db = getDatabase();
  const stmts = getStatements();
  const p = data.prompt;

  let promptId: number | null = null;

  const insert = db.transaction(() => {
    const result = stmts.insertPrompt.run({
      request_id: p.request_id,
      session_id: p.session_id,
      timestamp: p.timestamp,
      source: p.source,
      provider: p.provider ?? "claude",
      user_prompt: p.user_prompt ?? null,
      user_prompt_tokens: p.user_prompt_tokens ?? 0,
      assistant_response: p.assistant_response ?? null,
      model: p.model,
      max_tokens: p.max_tokens ?? 0,
      conversation_turns: p.conversation_turns ?? 0,
      user_messages_count: p.user_messages_count ?? 0,
      assistant_messages_count: p.assistant_messages_count ?? 0,
      tool_result_count: p.tool_result_count ?? 0,
      system_tokens: p.system_tokens ?? 0,
      messages_tokens: p.messages_tokens ?? 0,
      user_text_tokens: p.user_text_tokens ?? 0,
      assistant_tokens: p.assistant_tokens ?? 0,
      tool_result_tokens: p.tool_result_tokens ?? 0,
      tools_definition_tokens: p.tools_definition_tokens ?? 0,
      total_context_tokens: p.total_context_tokens ?? 0,
      total_injected_tokens: p.total_injected_tokens ?? 0,
      tool_summary: JSON.stringify(p.tool_summary ?? {}),
      input_tokens: p.input_tokens ?? 0,
      output_tokens: p.output_tokens ?? 0,
      cache_creation_input_tokens: p.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: p.cache_read_input_tokens ?? 0,
      cost_usd: p.cost_usd ?? 0,
      duration_ms: p.duration_ms ?? 0,
      req_messages_count: p.req_messages_count ?? 0,
      req_tools_count: p.req_tools_count ?? 0,
      req_has_system: p.req_has_system ? 1 : 0,
    });

    // INSERT OR IGNORE returns changes=0 if duplicate request_id
    if (result.changes === 0) return;
    promptId = result.lastInsertRowid as number;

    for (const f of data.injected_files ?? []) {
      stmts.insertInjectedFile.run({
        prompt_id: promptId,
        path: f.path,
        category: f.category,
        estimated_tokens: f.estimated_tokens,
      });
    }

    for (const t of data.tool_calls ?? []) {
      stmts.insertToolCall.run({
        prompt_id: promptId,
        call_index: t.call_index,
        name: t.name,
        input_summary: t.input_summary ?? null,
        timestamp: t.timestamp ?? null,
      });
    }

    for (const a of data.agent_calls ?? []) {
      stmts.insertAgentCall.run({
        prompt_id: promptId,
        call_index: a.call_index,
        subagent_type: a.subagent_type ?? null,
        description: a.description ?? null,
      });
    }
  });

  insert();

  // Update aggregate tables if we actually inserted (skip in batch mode)
  if (promptId !== null && !options?.skipAggregates) {
    const prov = p.provider ?? "claude";
    upsertDailyStats(p.timestamp.slice(0, 10), prov);
    upsertSession(p.session_id, prov);
  }

  return promptId;
};

export const upsertDailyStats = (date: string, provider = "claude"): void => {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO daily_stats (date, provider, request_count, total_cost_usd, total_input_tokens, total_output_tokens, total_context_tokens, avg_context_tokens, cache_hit_rate, models_used, updated_at)
    SELECT
      substr(timestamp, 1, 10) as date,
      @provider as provider,
      COUNT(*) as request_count,
      SUM(cost_usd) as total_cost_usd,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(total_context_tokens) as total_context_tokens,
      AVG(total_context_tokens) as avg_context_tokens,
      CASE WHEN SUM(cache_read_input_tokens + cache_creation_input_tokens + input_tokens) > 0
        THEN CAST(SUM(cache_read_input_tokens) AS REAL) / SUM(cache_read_input_tokens + cache_creation_input_tokens + input_tokens) * 100
        ELSE 0
      END as cache_hit_rate,
      json_group_array(DISTINCT model) as models_used,
      datetime('now') as updated_at
    FROM prompts
    WHERE substr(timestamp, 1, 10) = @date AND provider = @provider
    GROUP BY substr(timestamp, 1, 10)
    ON CONFLICT(date, provider) DO UPDATE SET
      request_count = excluded.request_count,
      total_cost_usd = excluded.total_cost_usd,
      total_input_tokens = excluded.total_input_tokens,
      total_output_tokens = excluded.total_output_tokens,
      total_context_tokens = excluded.total_context_tokens,
      avg_context_tokens = excluded.avg_context_tokens,
      cache_hit_rate = excluded.cache_hit_rate,
      models_used = excluded.models_used,
      updated_at = excluded.updated_at
  `,
  ).run({ date, provider });
};

export const upsertSession = (sessionId: string, provider = "claude"): void => {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO sessions (session_id, first_timestamp, last_timestamp, prompt_count, total_cost_usd, total_context_tokens, total_output_tokens, total_cache_read_tokens, models_used, provider, project, updated_at)
    SELECT
      session_id,
      MIN(timestamp) as first_timestamp,
      MAX(timestamp) as last_timestamp,
      COUNT(*) as prompt_count,
      SUM(cost_usd) as total_cost_usd,
      SUM(total_context_tokens) as total_context_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(cache_read_input_tokens) as total_cache_read_tokens,
      json_group_array(DISTINCT model) as models_used,
      @provider as provider,
      NULL as project,
      datetime('now') as updated_at
    FROM prompts
    WHERE session_id = @session_id
    GROUP BY session_id
    ON CONFLICT(session_id) DO UPDATE SET
      first_timestamp = excluded.first_timestamp,
      last_timestamp = excluded.last_timestamp,
      prompt_count = excluded.prompt_count,
      total_cost_usd = excluded.total_cost_usd,
      total_context_tokens = excluded.total_context_tokens,
      total_output_tokens = excluded.total_output_tokens,
      total_cache_read_tokens = excluded.total_cache_read_tokens,
      models_used = excluded.models_used,
      provider = excluded.provider,
      updated_at = excluded.updated_at
  `,
  ).run({ session_id: sessionId, provider });
};

// --- Evidence scoring persistence ---

import type { EvidenceReport } from '../evidence/types';

export const insertEvidenceReport = (
  promptId: number,
  report: EvidenceReport,
): number | null => {
  const db = getDatabase();

  const insertReport = db.prepare(`
    INSERT OR IGNORE INTO evidence_reports (
      prompt_id, request_id, timestamp, engine_version,
      fusion_method, confirmed_min, likely_min
    ) VALUES (
      @prompt_id, @request_id, @timestamp, @engine_version,
      @fusion_method, @confirmed_min, @likely_min
    )
  `);

  const insertFileScore = db.prepare(`
    INSERT INTO file_evidence_scores (
      report_id, file_path, category, raw_score,
      normalized_score, classification, signals_json
    ) VALUES (
      @report_id, @file_path, @category, @raw_score,
      @normalized_score, @classification, @signals_json
    )
  `);

  let reportId: number | null = null;

  const tx = db.transaction(() => {
    const result = insertReport.run({
      prompt_id: promptId,
      request_id: report.request_id,
      timestamp: report.timestamp,
      engine_version: report.engine_version,
      fusion_method: report.fusion_method,
      confirmed_min: report.thresholds.confirmed_min,
      likely_min: report.thresholds.likely_min,
    });

    if (result.changes === 0) return;
    reportId = result.lastInsertRowid as number;

    for (const f of report.files) {
      insertFileScore.run({
        report_id: reportId,
        file_path: f.filePath,
        category: f.category,
        raw_score: f.rawScore,
        normalized_score: f.normalizedScore,
        classification: f.classification,
        signals_json: JSON.stringify(f.signals),
      });
    }
  });

  tx();
  return reportId;
};

export const clearStatementCache = (): void => {
  stmtCache = {};
};
