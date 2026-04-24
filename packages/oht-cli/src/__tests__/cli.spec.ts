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
  it("prints the semver-style version on --version and exits 0", () => {
    const out = new CapturingStream();
    const code = runCli(["--version"], out);
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(`oht ${CLI_VERSION}`);
  });

  it("supports -v as a short flag alias for --version", () => {
    const out = new CapturingStream();
    const code = runCli(["-v"], out);
    expect(code).toBe(0);
    expect(out.text).toContain(CLI_VERSION);
  });

  it("prints help when invoked with no arguments", () => {
    const out = new CapturingStream();
    const code = runCli([], out);
    expect(code).toBe(0);
    expect(out.text).toContain("Usage:");
    expect(out.text).toContain("oht --version");
    expect(out.text).toContain("oht --help");
  });

  it("lists future subcommands in help output so Phase 2/6 are visible to users today", () => {
    const out = new CapturingStream();
    runCli(["--help"], out);
    expect(out.text).toContain("tui");
    expect(out.text).toContain("statusline");
  });

  it("reports an unknown subcommand with the offending token and exits with code 2", () => {
    const out = new CapturingStream();
    const code = runCli(["bogus-command"], out);
    expect(code).toBe(2);
    expect(out.text).toContain("bogus-command");
    expect(out.text.toLowerCase()).toContain("unknown");
  });

  it("CLI_VERSION is a non-empty semver string so release automation can key on it", () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.-]+)?$/);
  });

  it("tui and statusline subcommands return a not-yet-implemented message with exit code 3", () => {
    // Placeholder behavior for Phase 2 / Phase 6 entry — the commands are
    // reachable today but intentionally stubbed. Once the phases land this
    // test will be replaced, not extended.
    const outTui = new CapturingStream();
    expect(runCli(["tui"], outTui)).toBe(3);
    expect(outTui.text.toLowerCase()).toContain("not yet implemented");

    const outStatus = new CapturingStream();
    expect(runCli(["statusline"], outStatus)).toBe(3);
    expect(outStatus.text.toLowerCase()).toContain("not yet implemented");
  });
});
