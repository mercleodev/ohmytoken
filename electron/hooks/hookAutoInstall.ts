import fs from "node:fs";
import path from "node:path";
import { installStopHook, uninstallStopHook, isHookInstalled } from "./settingsInstaller";

export type StopHookEnv = {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
};

export type InstallResult =
  | { status: "installed" }
  | { status: "already" }
  | { status: "error"; reason: string };

export type UninstallResult =
  | { status: "uninstalled" }
  | { status: "absent" }
  | { status: "error"; reason: string };

/**
 * Build the command string the Claude Code hook runner will spawn. In dev
 * mode the bin script lives next to the worktree; in a packaged Electron
 * app it ships in `extraResources` (outside the asar archive) so that
 * plain `node` can execute it. Keep the resolver pure so the lifecycle
 * wiring can pass either a real `app` instance or a test fixture.
 */
export const resolveStopHookCommand = (env: StopHookEnv): string => {
  const base = env.isPackaged ? env.resourcesPath : env.appPath;
  const script = path.join(base, "bin", "stop-hook.mjs");
  // Quote so dev worktrees with spaces (e.g. `~/Desktop/folder with space/...`)
  // do not split into two argv when Claude Code's hook runner spawns the
  // command via the shell.
  return `node '${script}'`;
};

const readSettings = (
  settingsPath: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } => {
  if (!fs.existsSync(settingsPath)) return { ok: true, value: {} };
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf-8");
  } catch (err) {
    return { ok: false, reason: `read_failed: ${(err as Error).message}` };
  }
  if (raw.trim().length === 0) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return { ok: false, reason: "settings root is not an object" };
  } catch (err) {
    return { ok: false, reason: `invalid_json: ${(err as Error).message}` };
  }
};

const atomicWriteSettings = (
  settingsPath: string,
  value: Record<string, unknown>,
): void => {
  const dir = path.dirname(settingsPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${settingsPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, settingsPath);
};

export const installHookOnStartup = (
  settingsPath: string,
  command: string,
): InstallResult => {
  const read = readSettings(settingsPath);
  if (!read.ok) return { status: "error", reason: read.reason };

  if (isHookInstalled(read.value, command)) {
    return { status: "already" };
  }

  const next = installStopHook(read.value, command);
  try {
    atomicWriteSettings(settingsPath, next);
  } catch (err) {
    return { status: "error", reason: `write_failed: ${(err as Error).message}` };
  }
  return { status: "installed" };
};

export const uninstallHookOnQuit = (
  settingsPath: string,
  command: string,
): UninstallResult => {
  if (!fs.existsSync(settingsPath)) return { status: "absent" };
  const read = readSettings(settingsPath);
  if (!read.ok) return { status: "error", reason: read.reason };

  if (!isHookInstalled(read.value, command)) {
    return { status: "absent" };
  }

  const next = uninstallStopHook(read.value, command);
  try {
    atomicWriteSettings(settingsPath, next);
  } catch (err) {
    return { status: "error", reason: `write_failed: ${(err as Error).message}` };
  }
  return { status: "uninstalled" };
};
