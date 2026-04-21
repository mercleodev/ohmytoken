import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { homedir } from "os";
import { runMigrations } from "./schema";

const DB_DIR = path.join(homedir(), ".checktoken");
const DB_FILE = "checktoken.db";

let db: Database.Database | null = null;

export const getDbPath = (): string => path.join(DB_DIR, DB_FILE);

export const initDatabase = (customPath?: string): Database.Database => {
  if (db) return db;

  const dbPath = customPath ?? getDbPath();
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  db = new Database(dbPath);

  if (dbPath !== ":memory:") {
    try { fs.chmodSync(dbPath, 0o600); } catch { /* best-effort: ignore on read-only FS */ }
  }

  // Performance pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -8000"); // 8MB cache

  runMigrations(db);

  return db;
};

export const getDatabase = (): Database.Database => {
  if (!db) {
    return initDatabase();
  }
  return db;
};

export const closeDatabase = (): void => {
  if (db) {
    db.close();
    db = null;
  }
};
