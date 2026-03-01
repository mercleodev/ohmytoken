import type Database from "better-sqlite3";

type Migration = {
  version: number;
  up: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(/* v1: core schema */ `
        CREATE TABLE prompts (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id    TEXT UNIQUE NOT NULL,
          session_id    TEXT NOT NULL,
          timestamp     TEXT NOT NULL,
          source        TEXT NOT NULL DEFAULT 'proxy',

          -- User input
          user_prompt       TEXT,
          user_prompt_tokens INTEGER DEFAULT 0,

          -- Assistant response
          assistant_response TEXT,

          -- Model info
          model         TEXT NOT NULL DEFAULT 'unknown',
          max_tokens    INTEGER DEFAULT 0,

          -- Conversation metrics
          conversation_turns      INTEGER DEFAULT 0,
          user_messages_count     INTEGER DEFAULT 0,
          assistant_messages_count INTEGER DEFAULT 0,
          tool_result_count       INTEGER DEFAULT 0,

          -- Context estimate
          system_tokens           INTEGER DEFAULT 0,
          messages_tokens         INTEGER DEFAULT 0,
          user_text_tokens        INTEGER DEFAULT 0,
          assistant_tokens        INTEGER DEFAULT 0,
          tool_result_tokens      INTEGER DEFAULT 0,
          tools_definition_tokens INTEGER DEFAULT 0,
          total_context_tokens    INTEGER DEFAULT 0,

          -- Injected files aggregate
          total_injected_tokens   INTEGER DEFAULT 0,

          -- Tool summary (JSON string)
          tool_summary    TEXT DEFAULT '{}',

          -- Usage (from SSE / history)
          input_tokens                  INTEGER DEFAULT 0,
          output_tokens                 INTEGER DEFAULT 0,
          cache_creation_input_tokens   INTEGER DEFAULT 0,
          cache_read_input_tokens       INTEGER DEFAULT 0,
          cost_usd                      REAL DEFAULT 0,
          duration_ms                   INTEGER DEFAULT 0,

          -- Request metadata
          req_messages_count  INTEGER DEFAULT 0,
          req_tools_count     INTEGER DEFAULT 0,
          req_has_system      INTEGER DEFAULT 0
        );

        CREATE INDEX idx_prompts_session ON prompts(session_id);
        CREATE INDEX idx_prompts_timestamp ON prompts(timestamp);
        CREATE INDEX idx_prompts_date ON prompts(substr(timestamp, 1, 10));
        CREATE INDEX idx_prompts_model ON prompts(model);

        CREATE TABLE injected_files (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_id   INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          path        TEXT NOT NULL,
          category    TEXT NOT NULL,
          estimated_tokens INTEGER DEFAULT 0
        );

        CREATE INDEX idx_injected_prompt ON injected_files(prompt_id);
        CREATE INDEX idx_injected_path ON injected_files(path);

        CREATE TABLE tool_calls (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_id   INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          call_index  INTEGER NOT NULL,
          name        TEXT NOT NULL,
          input_summary TEXT,
          timestamp   TEXT
        );

        CREATE INDEX idx_toolcalls_prompt ON tool_calls(prompt_id);
        CREATE INDEX idx_toolcalls_name ON tool_calls(name);

        CREATE TABLE agent_calls (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_id       INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          call_index      INTEGER NOT NULL,
          subagent_type   TEXT,
          description     TEXT
        );

        CREATE INDEX idx_agentcalls_prompt ON agent_calls(prompt_id);

        CREATE TABLE daily_stats (
          date            TEXT PRIMARY KEY,
          request_count   INTEGER DEFAULT 0,
          total_cost_usd  REAL DEFAULT 0,
          total_input_tokens    INTEGER DEFAULT 0,
          total_output_tokens   INTEGER DEFAULT 0,
          total_context_tokens  INTEGER DEFAULT 0,
          avg_context_tokens    INTEGER DEFAULT 0,
          cache_hit_rate        REAL DEFAULT 0,
          models_used     TEXT DEFAULT '[]',
          updated_at      TEXT NOT NULL
        );

        CREATE TABLE sessions (
          session_id      TEXT PRIMARY KEY,
          first_timestamp TEXT NOT NULL,
          last_timestamp  TEXT NOT NULL,
          prompt_count    INTEGER DEFAULT 0,
          total_cost_usd  REAL DEFAULT 0,
          total_context_tokens INTEGER DEFAULT 0,
          models_used     TEXT DEFAULT '[]',
          project         TEXT,
          updated_at      TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(/* v2: evidence scoring tables */ `
        CREATE TABLE evidence_reports (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_id     INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          request_id    TEXT NOT NULL,
          timestamp     TEXT NOT NULL,
          engine_version TEXT NOT NULL,
          fusion_method TEXT NOT NULL,
          confirmed_min REAL NOT NULL,
          likely_min    REAL NOT NULL,
          UNIQUE(request_id)
        );

        CREATE INDEX idx_evidence_reports_prompt ON evidence_reports(prompt_id);
        CREATE INDEX idx_evidence_reports_request ON evidence_reports(request_id);

        CREATE TABLE file_evidence_scores (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          report_id     INTEGER NOT NULL REFERENCES evidence_reports(id) ON DELETE CASCADE,
          file_path     TEXT NOT NULL,
          category      TEXT NOT NULL,
          raw_score     REAL NOT NULL DEFAULT 0,
          normalized_score REAL NOT NULL DEFAULT 0,
          classification TEXT NOT NULL DEFAULT 'unverified',
          signals_json  TEXT NOT NULL DEFAULT '[]'
        );

        CREATE INDEX idx_file_evidence_report ON file_evidence_scores(report_id);
        CREATE INDEX idx_file_evidence_path ON file_evidence_scores(file_path);
        CREATE INDEX idx_file_evidence_classification ON file_evidence_scores(classification);
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(/* v3: session token composition columns */ `
        ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN total_cache_read_tokens INTEGER DEFAULT 0;
      `);
      // Backfill from existing prompts
      db.exec(`
        UPDATE sessions SET
          total_output_tokens = (
            SELECT COALESCE(SUM(output_tokens), 0)
            FROM prompts WHERE prompts.session_id = sessions.session_id
          ),
          total_cache_read_tokens = (
            SELECT COALESCE(SUM(cache_read_input_tokens), 0)
            FROM prompts WHERE prompts.session_id = sessions.session_id
          )
      `);
    },
  },
  {
    version: 4,
    up: (db) => {
      db.exec(/* v4: app metadata for backfill tracking */ `
        CREATE TABLE IF NOT EXISTS app_metadata (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 5,
    up: (db) => {
      // Add provider column to prompts and sessions
      db.exec(`
        ALTER TABLE prompts ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
        ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';

        CREATE INDEX idx_prompts_provider ON prompts(provider);
        CREATE INDEX idx_sessions_provider ON sessions(provider);
      `);

      // Recreate daily_stats with composite PK (date, provider)
      db.exec(`
        CREATE TABLE daily_stats_new (
          date            TEXT NOT NULL,
          provider        TEXT NOT NULL DEFAULT 'claude',
          request_count   INTEGER DEFAULT 0,
          total_cost_usd  REAL DEFAULT 0,
          total_input_tokens    INTEGER DEFAULT 0,
          total_output_tokens   INTEGER DEFAULT 0,
          total_context_tokens  INTEGER DEFAULT 0,
          avg_context_tokens    INTEGER DEFAULT 0,
          cache_hit_rate        REAL DEFAULT 0,
          models_used     TEXT DEFAULT '[]',
          updated_at      TEXT NOT NULL,
          PRIMARY KEY (date, provider)
        );

        INSERT INTO daily_stats_new (date, provider, request_count, total_cost_usd, total_input_tokens, total_output_tokens, total_context_tokens, avg_context_tokens, cache_hit_rate, models_used, updated_at)
        SELECT date, 'claude', request_count, total_cost_usd, total_input_tokens, total_output_tokens, total_context_tokens, avg_context_tokens, cache_hit_rate, models_used, updated_at
        FROM daily_stats;

        DROP TABLE daily_stats;
        ALTER TABLE daily_stats_new RENAME TO daily_stats;
      `);
    },
  },
  {
    version: 6,
    up: (db) => {
      // Backfill tool_result_count from tool_summary JSON for existing prompts
      db.exec(`
        UPDATE prompts
        SET tool_result_count = (
          SELECT COALESCE(SUM(value), 0)
          FROM json_each(prompts.tool_summary)
        )
        WHERE tool_result_count = 0
          AND tool_summary IS NOT NULL
          AND tool_summary != '{}'
      `);
    },
  },
];

export const runMigrations = (db: Database.Database): void => {
  const currentVersion =
    (db.pragma("user_version", { simple: true }) as number) ?? 0;

  const pending = migrations.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  const migrate = db.transaction(() => {
    for (const m of pending) {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    }
  });

  migrate();
};
