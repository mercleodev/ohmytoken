import { describe, it, expect } from "vitest";
import {
  isHookInstalled,
  installStopHook,
  uninstallStopHook,
} from "../settingsInstaller";

const HOOK_CMD = "node oht-bin/stop-hook.mjs";
const OTHER_CMD = "python3 fixture-canary-collector.py";

const settingsWithCanary = (): Record<string, unknown> => ({
  permissions: { allow: ["Bash(*)"] },
  hooks: {
    Stop: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: OTHER_CMD }],
      },
    ],
  },
  theme: "dark",
});

const settingsEmpty = (): Record<string, unknown> => ({ theme: "dark" });

describe("settingsInstaller", () => {
  describe("isHookInstalled", () => {
    it("returns false on empty settings", () => {
      expect(isHookInstalled(settingsEmpty(), HOOK_CMD)).toBe(false);
    });

    it("returns false when only an unrelated Stop hook exists", () => {
      expect(isHookInstalled(settingsWithCanary(), HOOK_CMD)).toBe(false);
    });

    it("returns true when our command path appears in any Stop matcher block", () => {
      const s = installStopHook(settingsWithCanary(), HOOK_CMD);
      expect(isHookInstalled(s, HOOK_CMD)).toBe(true);
    });
  });

  describe("installStopHook", () => {
    it("creates a hooks.Stop array if none exists, with one matcher block containing our command", () => {
      const out = installStopHook(settingsEmpty(), HOOK_CMD);
      const stop = (out as { hooks?: { Stop?: unknown[] } }).hooks?.Stop ?? [];
      expect(Array.isArray(stop)).toBe(true);
      expect(stop).toHaveLength(1);
      expect(JSON.stringify(stop)).toContain(HOOK_CMD);
    });

    it("preserves a pre-existing rule-canary Stop hook entry untouched", () => {
      const before = settingsWithCanary();
      const out = installStopHook(before, HOOK_CMD);
      expect(JSON.stringify(out)).toContain(OTHER_CMD);
      const stop = (out as { hooks: { Stop: unknown[] } }).hooks.Stop;
      expect(stop.length).toBeGreaterThanOrEqual(2);
    });

    it("is idempotent: running it twice produces the same shape and does not duplicate our entry", () => {
      const once = installStopHook(settingsWithCanary(), HOOK_CMD);
      const twice = installStopHook(once, HOOK_CMD);
      expect(twice).toEqual(once);
    });

    it("does not mutate the input settings object", () => {
      const before = settingsWithCanary();
      const beforeJson = JSON.stringify(before);
      installStopHook(before, HOOK_CMD);
      expect(JSON.stringify(before)).toBe(beforeJson);
    });
  });

  describe("uninstallStopHook", () => {
    it("removes only our matcher block and leaves the canary block intact", () => {
      const installed = installStopHook(settingsWithCanary(), HOOK_CMD);
      const out = uninstallStopHook(installed, HOOK_CMD);
      expect(JSON.stringify(out)).toContain(OTHER_CMD);
      expect(JSON.stringify(out)).not.toContain(HOOK_CMD);
    });

    it("is a no-op when our hook is not installed", () => {
      const before = settingsWithCanary();
      const out = uninstallStopHook(before, HOOK_CMD);
      expect(out).toEqual(before);
    });

    it("install -> uninstall is a value-level round-trip (preserves the original settings object)", () => {
      const before = settingsWithCanary();
      const installed = installStopHook(before, HOOK_CMD);
      const restored = uninstallStopHook(installed, HOOK_CMD);
      expect(restored).toEqual(before);
    });

    it("removes hooks.Stop entirely if it becomes empty after uninstall", () => {
      const installed = installStopHook(settingsEmpty(), HOOK_CMD);
      const restored = uninstallStopHook(installed, HOOK_CMD);
      const hooks = (restored as { hooks?: unknown }).hooks;
      const stopVal = (hooks as { Stop?: unknown } | undefined)?.Stop;
      expect(stopVal === undefined || (Array.isArray(stopVal) && stopVal.length === 0)).toBe(
        true,
      );
    });

    it("does not mutate the input settings object", () => {
      const installed = installStopHook(settingsWithCanary(), HOOK_CMD);
      const beforeJson = JSON.stringify(installed);
      uninstallStopHook(installed, HOOK_CMD);
      expect(JSON.stringify(installed)).toBe(beforeJson);
    });
  });
});
