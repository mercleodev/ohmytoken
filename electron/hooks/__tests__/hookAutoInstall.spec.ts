import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveStopHookCommand,
  installHookOnStartup,
  uninstallHookOnQuit,
} from "../hookAutoInstall";

const tmpSettingsPath = () =>
  path.join(
    os.tmpdir(),
    `oht-test-settings-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

const HOOK_CMD = "node /opt/oht/bin/stop-hook.mjs";
const OTHER_CMD = "python3 fixture-canary-collector.py";

describe("resolveStopHookCommand", () => {
  it("quotes the script path so dev worktrees containing spaces still spawn correctly", () => {
    const cmd = resolveStopHookCommand({
      isPackaged: false,
      appPath: "/tmp/dir with space",
      resourcesPath: "/ignored",
    });
    expect(cmd).toBe("node '/tmp/dir with space/bin/stop-hook.mjs'");
  });

  it("uses process.resourcesPath when the Electron app is packaged", () => {
    const cmd = resolveStopHookCommand({
      isPackaged: true,
      appPath: "/dev/should-not-be-used",
      resourcesPath: "/Applications/OhMyToken.app/Contents/Resources",
    });
    expect(cmd).toBe("node '/Applications/OhMyToken.app/Contents/Resources/bin/stop-hook.mjs'");
  });

  it("uses app.getAppPath() in dev mode", () => {
    const cmd = resolveStopHookCommand({
      isPackaged: false,
      appPath: "/tmp/dev-fixture-app",
      resourcesPath: "/ignored",
    });
    expect(cmd).toBe("node '/tmp/dev-fixture-app/bin/stop-hook.mjs'");
  });
});

describe("installHookOnStartup", () => {
  let settingsPath = "";

  beforeEach(() => {
    settingsPath = tmpSettingsPath();
  });
  afterEach(() => {
    try {
      fs.unlinkSync(settingsPath);
    } catch {
      /* ignore */
    }
  });

  it("creates the settings file with our hook when none exists", () => {
    const res = installHookOnStartup(settingsPath, HOOK_CMD);
    expect(res.status).toBe("installed");
    const written = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(JSON.stringify(written)).toContain(HOOK_CMD);
  });

  it("returns status='already' and does NOT rewrite when our hook is already installed", () => {
    installHookOnStartup(settingsPath, HOOK_CMD); // prime
    const before = fs.readFileSync(settingsPath, "utf-8");
    const mtimeBefore = fs.statSync(settingsPath).mtimeMs;

    const res = installHookOnStartup(settingsPath, HOOK_CMD);
    expect(res.status).toBe("already");

    const after = fs.readFileSync(settingsPath, "utf-8");
    expect(after).toBe(before);
    // mtime should not have advanced because we never wrote
    expect(fs.statSync(settingsPath).mtimeMs).toBe(mtimeBefore);
  });

  it("preserves a pre-existing third-party Stop hook entry", () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          theme: "dark",
          hooks: {
            Stop: [
              {
                matcher: "*",
                hooks: [{ type: "command", command: OTHER_CMD }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    const res = installHookOnStartup(settingsPath, HOOK_CMD);
    expect(res.status).toBe("installed");

    const written = fs.readFileSync(settingsPath, "utf-8");
    expect(written).toContain(OTHER_CMD);
    expect(written).toContain(HOOK_CMD);
    expect(written).toContain('"theme": "dark"');
  });

  it("returns status='error' with a reason when the settings file is malformed JSON", () => {
    fs.writeFileSync(settingsPath, "{not json", "utf-8");
    const res = installHookOnStartup(settingsPath, HOOK_CMD);
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.reason).toBeDefined();
    }
  });

  it("creates parent directories if the settings file path is in a missing dir", () => {
    const nestedPath = path.join(
      os.tmpdir(),
      `oht-test-nested-${process.pid}-${Date.now()}`,
      "settings.json",
    );
    const res = installHookOnStartup(nestedPath, HOOK_CMD);
    expect(res.status).toBe("installed");
    expect(fs.existsSync(nestedPath)).toBe(true);
    fs.unlinkSync(nestedPath);
    fs.rmdirSync(path.dirname(nestedPath));
  });

  it("writes atomically (no partial-write window where settings.json is empty)", () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ theme: "dark" }, null, 2),
      "utf-8",
    );
    const res = installHookOnStartup(settingsPath, HOOK_CMD);
    expect(res.status).toBe("installed");

    // After atomic write the file should never be 0 bytes
    const stat = fs.statSync(settingsPath);
    expect(stat.size).toBeGreaterThan(0);

    // Temp scratch file must not be left behind
    const tmpScratch = `${settingsPath}.tmp`;
    expect(fs.existsSync(tmpScratch)).toBe(false);
  });
});

describe("uninstallHookOnQuit", () => {
  let settingsPath = "";

  beforeEach(() => {
    settingsPath = tmpSettingsPath();
  });
  afterEach(() => {
    try {
      fs.unlinkSync(settingsPath);
    } catch {
      /* ignore */
    }
  });

  it("removes only our hook and keeps a pre-existing third-party Stop hook intact", () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              { matcher: "*", hooks: [{ type: "command", command: OTHER_CMD }] },
            ],
          },
        },
        null,
        2,
      ),
    );
    installHookOnStartup(settingsPath, HOOK_CMD);

    const res = uninstallHookOnQuit(settingsPath, HOOK_CMD);
    expect(res.status).toBe("uninstalled");

    const after = fs.readFileSync(settingsPath, "utf-8");
    expect(after).toContain(OTHER_CMD);
    expect(after).not.toContain(HOOK_CMD);
  });

  it("returns status='absent' when our hook is not installed", () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }), "utf-8");
    const res = uninstallHookOnQuit(settingsPath, HOOK_CMD);
    expect(res.status).toBe("absent");
  });

  it("returns status='absent' when the settings file does not exist", () => {
    const missing = tmpSettingsPath();
    const res = uninstallHookOnQuit(missing, HOOK_CMD);
    expect(res.status).toBe("absent");
  });

  it("install -> uninstall round-trip restores the prior settings content (value-level)", () => {
    const original = { theme: "dark", permissions: { allow: ["Bash(*)"] } };
    fs.writeFileSync(settingsPath, JSON.stringify(original, null, 2), "utf-8");

    installHookOnStartup(settingsPath, HOOK_CMD);
    uninstallHookOnQuit(settingsPath, HOOK_CMD);

    const restored = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(restored).toEqual(original);
  });
});
