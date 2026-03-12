/**
 * History Session Importer
 *
 * Parses Claude session JSONL files (~/.claude/projects/*\/*.jsonl)
 * and batch-imports prompt data into the SQLite DB.
 *
 * Two entry points:
 * - importHistorySessions(): one-time batch import on first run
 * - importSinglePrompt(): real-time import when historyWatcher detects new entry
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { getDatabase } from "../db/index";
import { insertPrompt, upsertDailyStats, upsertSession } from "../db/writer";
import { calculateCost } from "../utils/costCalculator";
import { countTokens } from "../analyzer/tokenCounter";
import type { InsertPromptData } from "../db/writer";

export type ImportResult = {
  imported: number;
  skipped: number;
  errors: number;
  durationMs: number;
};

type RawEntry = {
  type: string;
  timestamp?: string;
  uuid?: string;
  message?: {
    role?: string;
    content?: string | any[];
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

/**
 * Check if a user entry has actual text content (not just tool_result blocks)
 */
/** Patterns that indicate system/internal messages, not real user prompts */
const SYSTEM_MESSAGE_PATTERNS = [
  "Compacted (ctrl+o to see full summary)",
  "This session is being continued from a previous conversation",
];

const isSystemMessage = (text: string): boolean => {
  const clean = stripAnsi(text).trim();
  return SYSTEM_MESSAGE_PATTERNS.some((p) => clean.includes(p));
};

const isRealUserPrompt = (entry: RawEntry): boolean => {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  if (!content) return false;
  if (typeof content === "string") {
    return content.trim().length > 0 && !isSystemMessage(content);
  }
  if (Array.isArray(content)) {
    // Messages containing tool_result blocks are tool responses, not real user prompts
    const hasToolResult = content.some((b: any) => b.type === "tool_result");
    if (hasToolResult) return false;
    const textParts = content
      .filter((b: any) => b.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text);
    if (textParts.length === 0) return false;
    const combined = textParts.join(" ");
    return combined.trim().length > 0 && !isSystemMessage(combined);
  }
  return false;
};

/**
 * Extract clean user prompt text from a user entry
 */
const stripAnsi = (text: string): string =>
  text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[[\d;]*m/g, "");

const cleanPromptText = (raw: string): string =>
  stripAnsi(raw)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

const extractUserText = (entry: RawEntry): string => {
  const content = entry.message?.content;
  if (!content) return "";
  if (typeof content === "string") return cleanPromptText(content);
  if (Array.isArray(content)) {
    return cleanPromptText(
      content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text || "")
        .join("\n"),
    );
  }
  return "";
};

/**
 * Parse a session JSONL file into raw entries
 */
const parseSessionFile = (filePath: string): RawEntry[] => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    const entries: RawEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        /* skip malformed lines */
      }
    }
    return entries;
  } catch {
    return [];
  }
};

/**
 * Find all session JSONL files across all projects.
 */
const findAllSessionFiles = (): Array<{
  filePath: string;
  sessionId: string;
  projectDir: string;
}> => {
  const projectsDir = path.join(homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const results: Array<{
    filePath: string;
    sessionId: string;
    projectDir: string;
  }> = [];

  try {
    const dirs = fs.readdirSync(projectsDir).filter((f) => {
      try {
        return fs.statSync(path.join(projectsDir, f)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const dir of dirs) {
      const dirPath = path.join(projectsDir, dir);
      try {
        const files = fs
          .readdirSync(dirPath)
          .filter((f) => UUID_PATTERN.test(f));
        for (const file of files) {
          results.push({
            filePath: path.join(dirPath, file),
            sessionId: file.replace(".jsonl", ""),
            projectDir: dir,
          });
        }
      } catch {
        /* skip inaccessible directories */
      }
    }
  } catch {
    /* skip */
  }

  return results;
};

/**
 * Extract tool_calls, tool_summary, agent_calls from entries in a turn range.
 */
const extractToolInfo = (
  entries: RawEntry[],
  startIdx: number,
  endIdx: number,
): {
  toolCalls: Array<{
    index: number;
    name: string;
    input_summary: string;
    timestamp?: string;
  }>;
  toolSummary: Record<string, number>;
  agentCalls: Array<{
    index: number;
    subagent_type: string;
    description: string;
  }>;
  toolResultCount: number;
} => {
  const toolCalls: Array<{
    index: number;
    name: string;
    input_summary: string;
    timestamp?: string;
  }> = [];
  const toolSummary: Record<string, number> = {};
  const agentCalls: Array<{
    index: number;
    subagent_type: string;
    description: string;
  }> = [];
  let toolResultCount = 0;
  let toolIdx = 0;

  const SUMMARY_FIELDS = [
    "file_path",
    "pattern",
    "command",
    "query",
    "prompt",
    "url",
    "selector",
    "description",
  ];

  for (let i = startIdx; i < endIdx; i++) {
    const entry = entries[i];

    // Extract tool_use from assistant messages
    if (
      entry.type === "assistant" &&
      entry.message?.content &&
      Array.isArray(entry.message.content)
    ) {
      for (const block of entry.message.content) {
        if (block.type === "tool_use") {
          const name = block.name || "Unknown";
          let inputStr = "";
          if (typeof block.input === "object" && block.input) {
            for (const field of SUMMARY_FIELDS) {
              if (
                block.input[field] &&
                typeof block.input[field] === "string"
              ) {
                inputStr = String(block.input[field]).slice(0, 500);
                break;
              }
            }
            if (!inputStr) inputStr = JSON.stringify(block.input).slice(0, 500);
          }
          toolCalls.push({
            index: toolIdx++,
            name,
            input_summary: inputStr,
            timestamp: entry.timestamp,
          });
          toolSummary[name] = (toolSummary[name] || 0) + 1;

          if (name === "Task" && block.input) {
            agentCalls.push({
              index: agentCalls.length,
              subagent_type: block.input.subagent_type || "unknown",
              description: block.input.description || "",
            });
          }
        }
      }
    }

    // Count tool_result in user messages (intermediate tool results)
    if (
      entry.type === "user" &&
      entry.message?.content &&
      Array.isArray(entry.message.content)
    ) {
      for (const block of entry.message.content) {
        if (block.type === "tool_result") {
          toolResultCount++;
        }
      }
    }
  }

  return { toolCalls, toolSummary, agentCalls, toolResultCount };
};

/**
 * Build InsertPromptData from parsed session data.
 */
const buildPromptData = (
  requestId: string,
  sessionId: string,
  userEntry: RawEntry,
  assistantEntry: RawEntry,
  entries: RawEntry[],
  userIdx: number,
  endIdx: number,
): InsertPromptData => {
  const userText = extractUserText(userEntry);
  const usage = assistantEntry.message!.usage!;
  const model = assistantEntry.message!.model || "unknown";
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const totalContext = inputTokens + cacheRead + cacheCreation;

  let userCount = 0;
  let assistantCount = 0;
  for (let i = 0; i <= userIdx; i++) {
    if (entries[i].type === "user") userCount++;
    if (entries[i].type === "assistant") assistantCount++;
  }

  const { toolCalls, toolSummary, agentCalls, toolResultCount } =
    extractToolInfo(entries, userIdx + 1, endIdx);

  const timestamp = userEntry.timestamp || new Date().toISOString();
  const cost = calculateCost(
    model,
    inputTokens,
    outputTokens,
    cacheRead,
    cacheCreation,
  );

  return {
    prompt: {
      request_id: requestId,
      session_id: sessionId,
      timestamp,
      source: "history",
      user_prompt: userText.slice(0, 500),
      user_prompt_tokens: countTokens(userText),
      model,
      max_tokens: 16000,
      conversation_turns: userCount,
      user_messages_count: userCount,
      assistant_messages_count: assistantCount,
      tool_result_count: toolResultCount,
      system_tokens: 0,
      messages_tokens: totalContext,
      user_text_tokens: 0,
      assistant_tokens: 0,
      tool_result_tokens: 0,
      tools_definition_tokens: 0,
      total_context_tokens: totalContext,
      total_injected_tokens: 0,
      tool_summary: toolSummary,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
      cost_usd: cost,
      duration_ms: 0,
      req_messages_count: userCount + assistantCount,
      req_tools_count: 0,
      req_has_system: true,
    },
    injected_files: [],
    tool_calls: toolCalls.map((t) => ({
      call_index: t.index,
      name: t.name,
      input_summary: t.input_summary,
      timestamp: t.timestamp,
    })),
    agent_calls: agentCalls.map((a) => ({
      call_index: a.index,
      subagent_type: a.subagent_type,
      description: a.description,
    })),
  };
};

/**
 * Read injected files from disk for a given project path and return total tokens.
 */
const readInjectedTokens = (projectPath: string): number => {
  let total = 0;
  const readFile = (fp: string) => {
    try {
      if (fs.existsSync(fp)) {
        total += countTokens(fs.readFileSync(fp, "utf-8"));
      }
    } catch {
      /* skip */
    }
  };
  const readDir = (dirPath: string) => {
    try {
      if (fs.existsSync(dirPath)) {
        for (const f of fs
          .readdirSync(dirPath)
          .filter((f) => f.endsWith(".md"))) {
          readFile(path.join(dirPath, f));
        }
      }
    } catch {
      /* skip */
    }
  };

  // Global CLAUDE.md + rules
  readFile(path.join(homedir(), ".claude", "CLAUDE.md"));
  readDir(path.join(homedir(), ".claude", "rules"));

  // Project CLAUDE.md + rules + memory
  if (projectPath && fs.existsSync(projectPath)) {
    readFile(path.join(projectPath, "CLAUDE.md"));
    readDir(path.join(projectPath, ".claude", "rules"));
    readDir(path.join(projectPath, ".claude", "memory"));
  }

  return total;
};

/**
 * Post-import: estimate system_tokens for batch-imported history prompts.
 * Groups by project (session file location) and calculates per-project injected tokens.
 * Updates: system_tokens, total_injected_tokens, messages_tokens = total_context - system.
 */
const estimateSystemTokens = (): void => {
  const db = getDatabase();

  // Get distinct session_ids that need estimation
  const sessions = db
    .prepare(
      "SELECT DISTINCT session_id FROM prompts WHERE source = 'history' AND system_tokens = 0",
    )
    .all() as Array<{ session_id: string }>;

  if (sessions.length === 0) return;

  // Build session → projectPath map from disk
  const projectsDir = path.join(homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return;

  const sessionProjectMap = new Map<string, string>(); // sessionId → projectPath
  const projectTokensCache = new Map<string, number>(); // projectDir → tokens

  const dirs = fs.readdirSync(projectsDir).filter((f) => {
    try {
      return fs.statSync(path.join(projectsDir, f)).isDirectory();
    } catch {
      return false;
    }
  });

  const sessionIdSet = new Set(sessions.map((s) => s.session_id));

  for (const dir of dirs) {
    const dirPath = path.join(projectsDir, dir);
    try {
      for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith(".jsonl")) continue;
        const sid = file.replace(".jsonl", "");
        if (sessionIdSet.has(sid)) {
          // Restore project path from dash-delimited directory name
          const projectPath = dir.replace(/^-/, "/").replace(/-/g, "/");
          sessionProjectMap.set(sid, projectPath);
        }
      }
    } catch {
      /* skip */
    }
  }

  // Calculate per-project injected tokens (cached)
  const getProjectTokens = (projectPath: string): number => {
    const dirKey = projectPath;
    if (projectTokensCache.has(dirKey)) return projectTokensCache.get(dirKey)!;
    const tokens = readInjectedTokens(projectPath);
    projectTokensCache.set(dirKey, tokens);
    return tokens;
  };

  // Batch UPDATE
  const updateStmt = db.prepare(`
    UPDATE prompts
    SET system_tokens = @system_tokens,
        total_injected_tokens = @total_injected_tokens,
        messages_tokens = CASE
          WHEN total_context_tokens > @system_tokens
          THEN total_context_tokens - @system_tokens
          ELSE total_context_tokens
        END
    WHERE session_id = @session_id AND source = 'history' AND system_tokens = 0
  `);

  const updateAll = db.transaction(() => {
    for (const [sid, projectPath] of sessionProjectMap) {
      const tokens = getProjectTokens(projectPath);
      if (tokens > 0) {
        updateStmt.run({
          system_tokens: tokens,
          total_injected_tokens: tokens,
          session_id: sid,
        });
      }
    }
  });

  updateAll();
};

/**
 * Import all history sessions into DB.
 * Skips if source='history' data already exists (first-run only).
 */
export const importHistorySessions = (): ImportResult => {
  const start = Date.now();
  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
  };

  const db = getDatabase();

  // Skip if history data already exists
  const historyCount = (
    db
      .prepare("SELECT COUNT(*) as cnt FROM prompts WHERE source = 'history'")
      .get() as { cnt: number }
  ).cnt;
  if (historyCount > 0) {
    result.durationMs = Date.now() - start;
    return result;
  }

  // Get existing request_ids to avoid duplicates with proxy data
  const existingIds = new Set<string>();
  const rows = db.prepare("SELECT request_id FROM prompts").all() as Array<{
    request_id: string;
  }>;
  for (const r of rows) existingIds.add(r.request_id);

  const sessionFiles = findAllSessionFiles();
  if (sessionFiles.length === 0) {
    result.durationMs = Date.now() - start;
    return result;
  }

  const touchedDates = new Set<string>();
  const touchedSessions = new Set<string>();

  const importAll = db.transaction(() => {
    for (const sf of sessionFiles) {
      try {
        const entries = parseSessionFile(sf.filePath);
        if (entries.length === 0) continue;

        // Find all "real user prompt" indices
        const userPromptIndices: number[] = [];
        for (let i = 0; i < entries.length; i++) {
          if (isRealUserPrompt(entries[i])) {
            userPromptIndices.push(i);
          }
        }

        for (let pi = 0; pi < userPromptIndices.length; pi++) {
          const userIdx = userPromptIndices[pi];
          const nextUserIdx =
            pi + 1 < userPromptIndices.length
              ? userPromptIndices[pi + 1]
              : entries.length;

          const userEntry = entries[userIdx];
          const requestId =
            userEntry.uuid || `history-${sf.sessionId}-${userIdx}`;
          if (existingIds.has(requestId)) {
            result.skipped++;
            continue;
          }

          // Find first assistant with usage in this turn
          let assistantEntry: RawEntry | null = null;
          for (let i = userIdx + 1; i < nextUserIdx; i++) {
            if (entries[i].type === "assistant" && entries[i].message?.usage) {
              assistantEntry = entries[i];
              break;
            }
          }

          if (!assistantEntry?.message?.usage) {
            result.skipped++;
            continue;
          }

          const userText = extractUserText(userEntry);
          if (!userText) {
            result.skipped++;
            continue;
          }

          const data = buildPromptData(
            requestId,
            sf.sessionId,
            userEntry,
            assistantEntry,
            entries,
            userIdx,
            nextUserIdx,
          );

          const id = insertPrompt(data, { skipAggregates: true });
          if (id !== null) {
            result.imported++;
            existingIds.add(requestId);
            const dateStr = (
              userEntry.timestamp || new Date().toISOString()
            ).slice(0, 10);
            touchedDates.add(dateStr);
            touchedSessions.add(sf.sessionId);
          } else {
            result.skipped++;
          }
        }
      } catch (err) {
        result.errors++;
      }
    }

    // Rebuild aggregate tables for all touched dates/sessions
    for (const d of touchedDates) upsertDailyStats(d);
    for (const s of touchedSessions) upsertSession(s);
  });

  try {
    importAll();
  } catch (err) {
    console.error("[HistoryImporter] Batch import failed:", err);
  }

  // Post-import: estimate system_tokens for all history prompts
  if (result.imported > 0) {
    try {
      estimateSystemTokens();
    } catch (err) {
      console.error("[HistoryImporter] system_tokens estimation failed:", err);
    }
  }

  result.durationMs = Date.now() - start;
  return result;
};

/**
 * Import a single prompt from a history session file.
 * Used for real-time import when historyWatcher detects new entries.
 */
export const importSinglePrompt = (
  sessionId: string,
  timestamp: number,
): string | null => {
  const projectsDir = path.join(homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return null;

  try {
    // Find the session file across projects
    const dirs = fs.readdirSync(projectsDir).filter((f) => {
      try {
        return fs.statSync(path.join(projectsDir, f)).isDirectory();
      } catch {
        return false;
      }
    });

    let filePath: string | null = null;
    for (const dir of dirs) {
      const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
    if (!filePath) return null;

    const entries = parseSessionFile(filePath);
    if (entries.length === 0) return null;

    // Find the user prompt closest to the given timestamp
    const targetMs = timestamp;
    let bestUserIdx = -1;
    let bestDiff = Infinity;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!isRealUserPrompt(entries[i])) continue;
      const entryMs = entries[i].timestamp
        ? new Date(entries[i].timestamp!).getTime()
        : 0;
      const diff = Math.abs(entryMs - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestUserIdx = i;
      }
      // Stop searching if we've gone too far back
      if (entryMs < targetMs - 120_000) break;
    }

    if (bestUserIdx < 0) return null;

    const userEntry = entries[bestUserIdx];
    const requestId = userEntry.uuid || `history-${sessionId}-${bestUserIdx}`;

    // Check for duplicate
    const db = getDatabase();
    const existing = db
      .prepare("SELECT id FROM prompts WHERE request_id = @rid")
      .get({ rid: requestId });
    if (existing) return null;

    // Find next real user prompt for range bounding
    let nextUserIdx = entries.length;
    for (let i = bestUserIdx + 1; i < entries.length; i++) {
      if (isRealUserPrompt(entries[i])) {
        nextUserIdx = i;
        break;
      }
    }

    // Find assistant with usage
    let assistantEntry: RawEntry | null = null;
    for (let i = bestUserIdx + 1; i < nextUserIdx; i++) {
      if (entries[i].type === "assistant" && entries[i].message?.usage) {
        assistantEntry = entries[i];
        break;
      }
    }

    if (!assistantEntry?.message?.usage) return null;

    const userText = extractUserText(userEntry);
    if (!userText) return null;

    const data = buildPromptData(
      requestId,
      sessionId,
      userEntry,
      assistantEntry,
      entries,
      bestUserIdx,
      nextUserIdx,
    );

    const id = insertPrompt(data);
    return id !== null ? requestId : null;
  } catch (err) {
    console.error("[HistoryImporter] Single import error:", err);
    return null;
  }
};
