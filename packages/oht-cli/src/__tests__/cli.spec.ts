import { describe, it, expect } from "vitest";

import { runCli, CLI_VERSION } from "../cli";

class CapturingStream {
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join("");
  }
}

describe("oht CLI entry", () => {
  it("prints the semver-style version on --version and exits 0", async () => {
    const out = new CapturingStream();
    const code = await runCli(["--version"], out);
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(`oht ${CLI_VERSION}`);
  });

  it("supports -v as a short flag alias for --version", async () => {
    const out = new CapturingStream();
    const code = await runCli(["-v"], out);
    expect(code).toBe(0);
    expect(out.text).toContain(CLI_VERSION);
  });

  it("prints help when invoked with no arguments", async () => {
    const out = new CapturingStream();
    const code = await runCli([], out);
    expect(code).toBe(0);
    expect(out.text).toContain("Usage:");
    expect(out.text).toContain("oht --version");
    expect(out.text).toContain("oht --help");
  });

  it("lists future subcommands in help output so Phase 2/6 are visible to users today", async () => {
    const out = new CapturingStream();
    await runCli(["--help"], out);
    expect(out.text).toContain("tui");
    expect(out.text).toContain("statusline");
  });

  it("reports an unknown subcommand with the offending token and exits with code 2", async () => {
    const out = new CapturingStream();
    const code = await runCli(["bogus-command"], out);
    expect(code).toBe(2);
    expect(out.text).toContain("bogus-command");
    expect(out.text.toLowerCase()).toContain("unknown");
  });

  it("CLI_VERSION is a non-empty semver string so release automation can key on it", () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.-]+)?$/);
  });

  it("tui subcommand still returns the not-yet-implemented stub with exit code 3", async () => {
    const outTui = new CapturingStream();
    expect(await runCli(["tui"], outTui)).toBe(3);
    expect(outTui.text.toLowerCase()).toContain("not yet implemented");
  });

  it("statusline now talks to the real bus — covered exhaustively in statusline.spec.ts", async () => {
    // P6-mini replaced the stub. We only need a smoke check here that the
    // command is reachable; the bus-conversation matrix is owned by
    // statusline.spec.ts. Point at a closed port so the runner falls back
    // to the not-running line and exits 2 within the timeout.
    const out = new CapturingStream();
    const code = await runCli(["statusline"], out, {
      port: 1, // privileged + closed → connect refused
      timeoutMs: 200,
    });
    expect(code).toBe(2);
    expect(out.text.toLowerCase()).toContain("not running");
  });
});
