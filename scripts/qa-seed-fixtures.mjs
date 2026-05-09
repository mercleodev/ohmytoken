#!/usr/bin/env node
/**
 * P0.4 — Deterministic fixture seeder for U1-VR (gate doc §7 P0.4).
 *
 * Materializes a fixed dataset into a temp HOME so the dashboard
 * renders the same populated data on every U1-VR re-capture. Pure
 * function of (fixture name, target HOME path): two invocations on
 * the same target HOME produce byte-identical output.
 *
 * Usage:
 *   node scripts/qa-seed-fixtures.mjs <profile> --home <path>
 *   node scripts/qa-seed-fixtures.mjs --list
 *
 * Profiles: populated | first-run | setup-guide | backfill
 *
 * Exit codes:
 *   0 — success
 *   1 — bad arguments / unknown profile
 *   2 — refused: HOME path looks like the user's real home
 *   3 — better-sqlite3 / runMigrations error
 *
 * NOT in scope (deferred to U1-VR): screenshot capture, agent-browser
 * orchestration, npm run build:electron.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

import { runMigrations } from "../electron/db/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const FIXTURES_PATH = join(REPO_ROOT, "scripts/qa-fixtures.json");

const FIXED_SEEDED_AT = "FIXED";
const SCHEMA_VERSION = 1;

function die(code, msg) {
  console.error(`[qa-seed-fixtures] ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { profile: null, home: null, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") args.list = true;
    else if (a === "--home") args.home = argv[++i] ?? null;
    else if (!a.startsWith("--") && args.profile === null) args.profile = a;
    else if (a === "-h" || a === "--help") {
      printUsage();
      process.exit(0);
    } else die(1, `unknown argument: ${a}`);
  }
  return args;
}

function printUsage() {
  console.log("Usage: node scripts/qa-seed-fixtures.mjs <profile> --home <path>");
  console.log("       node scripts/qa-seed-fixtures.mjs --list");
}

function assertSafeHome(homePath) {
  const real = homedir();
  const normalized = resolve(homePath);
  if (
    normalized === resolve(real) ||
    normalized === "/" ||
    normalized === "" ||
    normalized.startsWith(resolve(real) + "/Library") ||
    normalized.startsWith(resolve(real) + "/Documents") ||
    normalized.startsWith(resolve(real) + "/Desktop") ||
    normalized === resolve(homedir())
  ) {
    die(2, `refusing to seed into real-looking HOME: ${normalized}`);
  }
  if (!normalized.includes("qa") && !normalized.startsWith("/tmp") && !normalized.startsWith("/private/tmp") && !normalized.startsWith("/var/folders")) {
    die(2, `refusing to seed: target HOME path must contain 'qa' or live under /tmp, /private/tmp, /var/folders. Got: ${normalized}`);
  }
}

function userDataDir(homePath, productName) {
  // Mirrors Electron app.getPath('userData') per platform.
  if (platform() === "darwin") {
    return join(homePath, "Library", "Application Support", productName);
  }
  if (platform() === "win32") {
    return join(homePath, "AppData", "Roaming", productName);
  }
  return join(homePath, ".config", productName);
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function writeJsonStable(path, obj) {
  // 2-space indent, sorted keys at every level for stable bytes.
  const stable = JSON.stringify(obj, sortedReplacer(obj), 2) + "\n";
  writeFileSync(path, stable, { encoding: "utf8" });
}

function sortedReplacer() {
  // Sort keys at every level for deterministic JSON output.
  return (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = value[k];
      return out;
    }
    return value;
  };
}

function writeJsonl(path, entries) {
  const body = entries.map((e) => JSON.stringify(e, sortedReplacer())).join("\n");
  writeFileSync(path, body + (body ? "\n" : ""), { encoding: "utf8" });
}

function seedSqlite(dbPath, dbProfile) {
  ensureDir(dirname(dbPath));
  if (existsSync(dbPath)) rmSync(dbPath);
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = DELETE"); // No WAL — easier to byte-compare.
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    runMigrations(db);

    if (!dbProfile) return;

    const insertSession = db.prepare(`
      INSERT INTO sessions (
        session_id, first_timestamp, last_timestamp, prompt_count,
        total_cost_usd, total_context_tokens, models_used, project,
        updated_at, total_output_tokens, total_cache_read_tokens, provider
      ) VALUES (
        @session_id, @first_timestamp, @last_timestamp, @prompt_count,
        @total_cost_usd, @total_context_tokens, @models_used, @project,
        @updated_at, @total_output_tokens, @total_cache_read_tokens, @provider
      )
    `);
    for (const s of dbProfile.sessions ?? []) insertSession.run(s);

    const insertPrompt = db.prepare(`
      INSERT INTO prompts (
        request_id, session_id, timestamp, source,
        user_prompt, user_prompt_tokens, assistant_response, model, max_tokens,
        conversation_turns, user_messages_count, assistant_messages_count, tool_result_count,
        system_tokens, messages_tokens, user_text_tokens, assistant_tokens,
        tool_result_tokens, tools_definition_tokens, total_context_tokens,
        total_injected_tokens, tool_summary,
        input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
        cost_usd, duration_ms,
        req_messages_count, req_tools_count, req_has_system,
        provider, git_branch, project_path
      ) VALUES (
        @request_id, @session_id, @timestamp, @source,
        @user_prompt, @user_prompt_tokens, @assistant_response, @model, @max_tokens,
        @conversation_turns, @user_messages_count, @assistant_messages_count, @tool_result_count,
        @system_tokens, @messages_tokens, @user_text_tokens, @assistant_tokens,
        @tool_result_tokens, @tools_definition_tokens, @total_context_tokens,
        @total_injected_tokens, @tool_summary,
        @input_tokens, @output_tokens, @cache_creation_input_tokens, @cache_read_input_tokens,
        @cost_usd, @duration_ms,
        @req_messages_count, @req_tools_count, @req_has_system,
        @provider, @git_branch, @project_path
      )
    `);
    const promptIdByRequestId = new Map();
    for (const p of dbProfile.prompts ?? []) {
      const info = insertPrompt.run(p);
      promptIdByRequestId.set(p.request_id, info.lastInsertRowid);
    }

    const insertEvidence = db.prepare(`
      INSERT INTO evidence_reports (
        prompt_id, request_id, timestamp, engine_version, fusion_method,
        confirmed_min, likely_min
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFileScore = db.prepare(`
      INSERT INTO file_evidence_scores (
        report_id, file_path, category, raw_score, normalized_score,
        classification, signals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of dbProfile.evidence_reports ?? []) {
      const promptId = promptIdByRequestId.get(r.prompt_request_id);
      if (!promptId) continue;
      const info = insertEvidence.run(
        promptId,
        r.request_id,
        r.timestamp,
        r.engine_version,
        r.fusion_method,
        r.confirmed_min,
        r.likely_min,
      );
      const reportId = info.lastInsertRowid;
      for (const f of r.files ?? []) {
        insertFileScore.run(
          reportId,
          f.file_path,
          f.category,
          f.raw_score,
          f.normalized_score,
          f.classification,
          f.signals_json,
        );
      }
    }

    const insertDaily = db.prepare(`
      INSERT INTO daily_stats (
        date, provider, request_count, total_cost_usd,
        total_input_tokens, total_output_tokens, total_context_tokens,
        avg_context_tokens, cache_hit_rate, models_used, updated_at
      ) VALUES (
        @date, @provider, @request_count, @total_cost_usd,
        @total_input_tokens, @total_output_tokens, @total_context_tokens,
        @avg_context_tokens, @cache_hit_rate, @models_used, @updated_at
      )
    `);
    for (const d of dbProfile.daily_stats ?? []) insertDaily.run(d);

    const insertMeta = db.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)`);
    for (const m of dbProfile.app_metadata ?? []) insertMeta.run(m.key, m.value);
  } finally {
    db.close();
  }
  try { chmodSync(dbPath, 0o600); } catch { /* best-effort */ }
}

function emitManifest(homePath, fixtureName, fixtures, outputs) {
  const subset = {
    schemaVersion: fixtures.schemaVersion,
    fixedNow: fixtures.fixedNow,
    fixedNowMs: fixtures.fixedNowMs,
    profile: fixtures.profiles[fixtureName],
  };
  const inputHash = createHash("sha256")
    .update(JSON.stringify(subset, sortedReplacer()))
    .digest("hex");
  const homePrefix = resolve(homePath);
  const relativeOutputs = outputs
    .map((p) => {
      const abs = resolve(p);
      if (abs === homePrefix) return ".";
      if (abs.startsWith(homePrefix + "/")) return abs.slice(homePrefix.length + 1);
      return abs; // shouldn't happen, but keep for visibility
    })
    .sort();
  const manifest = {
    fixture: fixtureName,
    schemaVersion: SCHEMA_VERSION,
    seededAt: FIXED_SEEDED_AT,
    inputHash,
    outputs: relativeOutputs,
  };
  writeJsonStable(join(homePath, ".fixture-manifest.json"), manifest);
}

function main() {
  const args = parseArgs(process.argv);
  const fixturesRaw = readFileSync(FIXTURES_PATH, "utf8");
  const fixtures = JSON.parse(fixturesRaw);

  if (args.list) {
    for (const name of Object.keys(fixtures.profiles).sort()) {
      const p = fixtures.profiles[name];
      console.log(`${name}\t${p.description ?? ""}`);
    }
    return;
  }

  if (!args.profile) {
    printUsage();
    die(1, "missing <profile>");
  }
  if (!fixtures.profiles[args.profile]) {
    die(1, `unknown profile: ${args.profile}. Run --list to see profiles.`);
  }
  if (!args.home) die(1, "missing --home <path>");

  assertSafeHome(args.home);

  const homePath = resolve(args.home);
  if (existsSync(homePath)) rmSync(homePath, { recursive: true, force: true });
  ensureDir(homePath);

  const profile = fixtures.profiles[args.profile];
  const productName = fixtures.productName;
  const outputs = [];

  // 1. Session roots (.claude/projects/..., .codex/sessions/...) — empty markers.
  for (const root of profile.sessionRoots ?? []) {
    const rootDir = join(homePath, root);
    ensureDir(rootDir);
    const marker = join(rootDir, ".fixture-marker");
    writeFileSync(marker, `seeded by qa-seed-fixtures ${args.profile}\n`);
    outputs.push(marker);
  }

  // 1b. Session files: deterministic UUID-named .jsonl files inside a
  // sessionRoots dir. The backfill orchestrator's countSessionFiles()
  // counts these; without at least one matching file the dashboard
  // never renders BackfillDialog (UsageDashboard.tsx:60-76 requires
  // count > 0). Used by the backfill profile to make the dialog
  // appear; safe no-op for profiles without sessionFiles.
  for (const entry of profile.sessionFiles ?? []) {
    const fileDir = join(homePath, entry.root);
    ensureDir(fileDir);
    const filePath = join(fileDir, entry.filename);
    const lines = (entry.lines ?? []).map((l) => JSON.stringify(l)).join("\n");
    writeFileSync(filePath, lines + (lines ? "\n" : ""));
    outputs.push(filePath);
  }

  // 2. ~/.claude/history.jsonl
  if ((profile.history ?? []).length > 0) {
    const histPath = join(homePath, ".claude", "history.jsonl");
    ensureDir(dirname(histPath));
    writeJsonl(histPath, profile.history);
    outputs.push(histPath);
  }

  // 3. ~/.claude/.credentials.json
  if (profile.credentials) {
    const credPath = join(homePath, ".claude", ".credentials.json");
    ensureDir(dirname(credPath));
    writeJsonStable(credPath, profile.credentials);
    try { chmodSync(credPath, 0o600); } catch { /* best-effort */ }
    outputs.push(credPath);
  }

  // 4. SQLite DB at ~/.checktoken/checktoken.db (only if profile.db !== null)
  if (profile.db !== null && profile.db !== undefined) {
    const dbPath = join(homePath, ".checktoken", "checktoken.db");
    seedSqlite(dbPath, profile.db);
    outputs.push(dbPath);
  }

  // 5. App config at <userData>/config.json
  if (profile.config) {
    const cfgDir = userDataDir(homePath, productName);
    const cfgPath = join(cfgDir, "config.json");
    ensureDir(cfgDir);
    writeJsonStable(cfgPath, profile.config);
    outputs.push(cfgPath);
  }

  // 6. Audit manifest (always, even for empty profiles).
  emitManifest(homePath, args.profile, fixtures, outputs);
  outputs.push(join(homePath, ".fixture-manifest.json"));

  console.log(`[qa-seed-fixtures] OK profile=${args.profile} home=${homePath} outputs=${outputs.length}`);
}

try {
  main();
} catch (err) {
  console.error("[qa-seed-fixtures] FAILED");
  console.error(err?.stack ?? err);
  process.exit(3);
}
