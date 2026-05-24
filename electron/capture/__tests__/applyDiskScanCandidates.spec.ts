import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { applyDiskScanCandidates } from "../applyDiskScanCandidates";
import type { InjectedFile } from "../../proxy/types";

const mkRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "oht-367-"));

const writeFile = (abs: string, content: string): void => {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

describe("applyDiskScanCandidates", () => {
  let cwd: string;
  let homeDir: string;

  beforeEach(() => {
    cwd = mkRoot();
    homeDir = mkRoot();
    writeFile(
      path.join(cwd, ".claude/rules/fsd.md"),
      "# FSD rule\nfeature-sliced design",
    );
    writeFile(
      path.join(cwd, ".claude/skills/datadog/SKILL.md"),
      "# datadog skill\nmonitoring",
    );
    writeFile(
      path.join(homeDir, ".claude/rules/global-style.md"),
      "# global style",
    );
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("merges seed entries with disk-scan candidates, deduped by absolute path", () => {
    const seed: InjectedFile[] = [
      {
        path: path.join(homeDir, ".claude/CLAUDE.md"),
        category: "global",
        estimated_tokens: 100,
      },
    ];
    const out = applyDiskScanCandidates(seed, cwd, homeDir);
    const paths = out.map((f) => f.path).sort();
    expect(paths).toContain(path.join(homeDir, ".claude/CLAUDE.md"));
    expect(paths).toContain(path.join(cwd, ".claude/rules/fsd.md"));
    expect(paths).toContain(path.join(cwd, ".claude/skills/datadog/SKILL.md"));
    expect(paths).toContain(path.join(homeDir, ".claude/rules/global-style.md"));
  });

  it("seed entries win on path collision (preserves their category + estimated_tokens)", () => {
    // Place a disk file at the same path as a seed entry
    const collidePath = path.join(cwd, ".claude/rules/fsd.md");
    const seed: InjectedFile[] = [
      {
        path: collidePath,
        category: "project", // seed says project; disk-scan would say rules
        estimated_tokens: 999, // seed-specified token count
      },
    ];
    const out = applyDiskScanCandidates(seed, cwd, homeDir);
    const match = out.find((f) => f.path === collidePath);
    expect(match).toBeDefined();
    // Seed wins: category stays "project", tokens stay 999.
    expect(match!.category).toBe("project");
    expect(match!.estimated_tokens).toBe(999);
  });

  it("returns the seed unchanged when cwd and homeDir are both undefined", () => {
    const seed: InjectedFile[] = [
      {
        path: "/tmp/synthetic.md",
        category: "global",
        estimated_tokens: 42,
      },
    ];
    const out = applyDiskScanCandidates(seed, undefined, undefined);
    expect(out).toEqual(seed);
  });

  it("returns just the disk-scan results when seed is empty", () => {
    const out = applyDiskScanCandidates([], cwd, homeDir);
    expect(out.length).toBe(3); // fsd + datadog SKILL + global-style
  });
});
