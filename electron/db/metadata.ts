import { getDatabase } from "./index";

export const getMetadata = (key: string): string | null => {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value FROM app_metadata WHERE key = @key")
    .get({ key }) as { value: string } | undefined;
  return row?.value ?? null;
};

export const setMetadata = (key: string, value: string): void => {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO app_metadata (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`,
  ).run({ key, value });
};

export const deleteMetadata = (key: string): void => {
  const db = getDatabase();
  db.prepare("DELETE FROM app_metadata WHERE key = @key").run({ key });
};

export const getLastScanTimestamp = (): number | null => {
  const raw = getMetadata("backfill_last_scan_ts");
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

export const setLastScanTimestamp = (epochMs: number): void => {
  setMetadata("backfill_last_scan_ts", String(epochMs));
};

export const isBackfillCompleted = (): boolean => {
  return getMetadata("backfill_completed") === "true";
};

export const setBackfillCompleted = (completed: boolean): void => {
  setMetadata("backfill_completed", completed ? "true" : "false");
};
