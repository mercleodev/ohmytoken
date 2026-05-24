import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { collectDotClaudeFiles } from "../dotClaudeScanner";

const TMP_PREFIX = "oht-dotclaude-test-";

const makeTmpRoot = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));

const writeFile = (abs: string, content: string): void => {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

describe("collectDotClaudeFiles", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns empty array when the directory does not exist", () => {
    const missing = path.join(root, "missing-root");
    expect(collectDotClaudeFiles(missing)).toEqual([]);
  });

  it("returns empty array when .claude exists but contains no rules/memory/skills subdirs", () => {
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    expect(collectDotClaudeFiles(root)).toEqual([]);
  });

  it("collects .md files from .claude/rules with category=rules", () => {
    writeFile(
      path.join(root, ".claude/rules/foo.md"),
      "<!-- canary:CANARY-foo -->\n# Foo rule\nsome content here",
    );
    writeFile(
      path.join(root, ".claude/rules/bar.md"),
      "# Bar rule\nother content",
    );

    const out = collectDotClaudeFiles(root);
    expect(out).toHaveLength(2);
    const paths = out.map((f) => f.path).sort();
    expect(paths).toEqual([
      path.join(root, ".claude/rules/bar.md"),
      path.join(root, ".claude/rules/foo.md"),
    ]);
    for (const f of out) {
      expect(f.category).toBe("rules");
      expect(f.estimated_tokens).toBeGreaterThan(0);
    }
  });

  it("collects .md files from .claude/memory with category=memory", () => {
    writeFile(
      path.join(root, ".claude/memory/proj_x.md"),
      "# memory: project x\nfacts about x",
    );
    const out = collectDotClaudeFiles(root);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("memory");
  });

  it("collects .md files from .claude/skills recursively with category=skill", () => {
    writeFile(
      path.join(root, ".claude/skills/my-skill/SKILL.md"),
      "# my skill\nbody",
    );
    writeFile(
      path.join(root, ".claude/skills/another/SKILL.md"),
      "# another skill\nbody",
    );
    const out = collectDotClaudeFiles(root);
    expect(out).toHaveLength(2);
    for (const f of out) {
      expect(f.category).toBe("skill");
    }
  });

  it("ignores non-.md files and hidden files inside rules dir", () => {
    writeFile(path.join(root, ".claude/rules/foo.md"), "rule");
    writeFile(path.join(root, ".claude/rules/notes.txt"), "ignored");
    writeFile(path.join(root, ".claude/rules/.hidden.md"), "hidden");
    const out = collectDotClaudeFiles(root);
    expect(out.map((f) => f.path)).toEqual([
      path.join(root, ".claude/rules/foo.md"),
    ]);
  });

  it("collects across rules, memory, and skills in one call with proper categories", () => {
    writeFile(path.join(root, ".claude/rules/r1.md"), "r1");
    writeFile(path.join(root, ".claude/memory/m1.md"), "m1");
    writeFile(path.join(root, ".claude/skills/s1/SKILL.md"), "s1");
    const out = collectDotClaudeFiles(root);
    const byCat = Object.fromEntries(
      out.map((f) => [f.category, f.path] as const),
    );
    expect(byCat.rules).toBe(path.join(root, ".claude/rules/r1.md"));
    expect(byCat.memory).toBe(path.join(root, ".claude/memory/m1.md"));
    expect(byCat.skill).toBe(path.join(root, ".claude/skills/s1/SKILL.md"));
  });

  it("returns empty array when rootDir argument is undefined", () => {
    expect(collectDotClaudeFiles(undefined)).toEqual([]);
  });
});
