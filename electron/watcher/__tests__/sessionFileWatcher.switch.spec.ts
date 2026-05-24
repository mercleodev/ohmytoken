/**
 * Regression test for #297.
 *
 * `startWatching(catchUp=true)` used to rewind the last 8 KiB of the session
 * file on every `switchSession`, which replayed every HumanTurn/AssistantTurn
 * in that window — driving the dashboard re-render storm and stale
 * `new-prompt-scan` broadcasts. The watcher must only observe entries written
 * after the switch; a session rotation never re-emits past turns.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

const HISTORICAL_HUMAN_LINE =
  JSON.stringify({
    type: "user",
    message: { content: "past prompt — should not be replayed" },
    timestamp: "2025-01-01T00:00:00.000Z",
  }) + "\n";

describe("startSessionFileWatcher — switchSession never replays past entries (#297)", () => {
  const originalHome = process.env.HOME;
  let tmpHome = "";
  let projectsDir = "";

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "omt-watcher-"));
    projectsDir = path.join(tmpHome, ".claude", "projects", "-test-project");
    fs.mkdirSync(projectsDir, { recursive: true });
    process.env.HOME = tmpHome;
    // Force the module to re-evaluate PROJECTS_DIR against the new HOME.
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("does not re-emit turns that existed before switchSession", async () => {
    const { startSessionFileWatcher } = await import("../sessionFileWatcher");

    // Seed session B with one historical HumanTurn so the rewind window
    // (old catchUp behavior) would include it.
    const sessionIdB = "22222222-2222-2222-2222-222222222222";
    const sessionFileB = path.join(projectsDir, `${sessionIdB}.jsonl`);
    fs.writeFileSync(sessionFileB, HISTORICAL_HUMAN_LINE);

    // Start the watcher — auto-detect may pick session B. Capture that baseline
    // before switchSession so we only count emits caused by the switch itself.
    const turns: Array<{ type: string }> = [];
    const watcher = startSessionFileWatcher({
      onTurn: (event) => turns.push(event),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const baseline = turns.length;

    // Switch to an unrelated session, then back to B. The switch back is where
    // the old rewind-on-catchUp would have re-emitted the historical line.
    const sessionIdA = "11111111-1111-1111-1111-111111111111";
    const sessionFileA = path.join(projectsDir, `${sessionIdA}.jsonl`);
    fs.writeFileSync(sessionFileA, "");

    watcher.switchSession(sessionIdA);
    await new Promise((resolve) => setTimeout(resolve, 30));
    watcher.switchSession(sessionIdB);
    await new Promise((resolve) => setTimeout(resolve, 30));

    watcher.cleanup();

    const replayed = turns.length - baseline;
    expect(replayed).toBe(0);
  });

  it("still emits turns appended after switchSession", async () => {
    const { startSessionFileWatcher } = await import("../sessionFileWatcher");

    const sessionIdA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const sessionFileA = path.join(projectsDir, `${sessionIdA}.jsonl`);
    fs.writeFileSync(sessionFileA, "");

    const turns: Array<{ type: string; userPrompt?: string }> = [];
    const watcher = startSessionFileWatcher({
      onTurn: (event) => turns.push(event),
    });

    watcher.switchSession(sessionIdA);
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Append a fresh line after the switch — this MUST be emitted.
    const freshLine =
      JSON.stringify({
        type: "user",
        message: { content: "new prompt after switch" },
        timestamp: new Date().toISOString(),
      }) + "\n";
    fs.appendFileSync(sessionFileA, freshLine);

    // Polling interval is 500 ms; give it time to observe the append.
    await new Promise((resolve) => setTimeout(resolve, 700));
    watcher.cleanup();

    const freshHuman = turns.find(
      (t) => t.type === "human" && t.userPrompt === "new prompt after switch",
    );
    expect(freshHuman).toBeDefined();
  });
});
