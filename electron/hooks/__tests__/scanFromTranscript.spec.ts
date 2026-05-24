import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { scanFromTranscript } from "../scanFromTranscript";

const TRANSCRIPT = path.join(__dirname, "fixtures", "minimal-session.jsonl");
const CC2X_TEMPLATE = path.join(
  __dirname,
  "fixtures",
  "cc2x-dotclaude-session.jsonl",
);
// Empty tmp home so the disk-scan helper finds no rule files for the
// legacy fixture tests. Tests for the new disk-scan behavior create
// their own home roots with controlled content.
const EMPTY_HOME = path.join(
  os.tmpdir(),
  `oht-test-empty-home-${process.pid}-${Date.now()}`,
);
// The global CLAUDE.md fixture is written to an OS tmp path at runtime so the
// repo's `**/*.md` gitignore rule cannot drop it from CI checkouts.
const GLOBAL_CLAUDE_MD = path.join(
  os.tmpdir(),
  `oht-test-global-claude-${process.pid}-${Date.now()}.md`,
);

beforeAll(() => {
  fs.writeFileSync(
    GLOBAL_CLAUDE_MD,
    "# Global Preferences (Fixture)\n\n- Sample global rule line for hook capture tests.\n",
  );
  fs.mkdirSync(EMPTY_HOME, { recursive: true });
});

afterAll(() => {
  try {
    fs.unlinkSync(GLOBAL_CLAUDE_MD);
  } catch {
    /* ignore missing tmp file */
  }
  try {
    fs.rmSync(EMPTY_HOME, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("scanFromTranscript", () => {
  it("returns null when the transcript file is missing", () => {
    expect(
      scanFromTranscript({
        transcriptPath: "/tmp/oht-hook-fixture-missing.jsonl",
        globalClaudeMdPath: GLOBAL_CLAUDE_MD,
        homeDir: EMPTY_HOME,
      }),
    ).toBeNull();
  });

  it("builds a PromptScan from the latest turn with project + global injected files and Anthropic-reported usage", () => {
    const result = scanFromTranscript({
      transcriptPath: TRANSCRIPT,
      globalClaudeMdPath: GLOBAL_CLAUDE_MD,
      homeDir: EMPTY_HOME,
    });
    expect(result).not.toBeNull();
    const { scan, usage } = result!;

    expect(scan.session_id).toBe("session-abc");
    expect(scan.user_prompt).toBe("hello from fixture");
    expect(scan.assistant_response).toBe("Hi there.");
    expect(scan.model).toBe("claude-test-model");
    expect(scan.git_branch).toBe("main");

    const paths = scan.injected_files.map((f) => f.path).sort();
    expect(paths).toEqual([GLOBAL_CLAUDE_MD, "/tmp/fixture-app/CLAUDE.md"].sort());

    const project = scan.injected_files.find(
      (f) => f.path.endsWith("CLAUDE.md") && f.category === "project",
    );
    const global = scan.injected_files.find((f) => f.category === "global");
    expect(project).toBeDefined();
    expect(global).toBeDefined();
    expect(project!.estimated_tokens).toBeGreaterThan(0);
    expect(global!.estimated_tokens).toBeGreaterThan(0);

    expect(scan.context_estimate.total_tokens).toBeGreaterThan(0);
    expect(scan.total_injected_tokens).toBe(
      scan.injected_files.reduce((sum, f) => sum + f.estimated_tokens, 0),
    );

    expect(usage.input_tokens).toBe(10);
    expect(usage.output_tokens).toBe(5);
  });

  // Issue #367: capture parity — both hook and history-import paths must
  // derive the prompt-row key from the same source. The history importer uses
  // userEntry.uuid; scanFromTranscript was using `turn.request_id` (the wire-
  // level Anthropic `req_<id>`). Aligning on user_uuid lets the existing
  // `prompts.request_id UNIQUE` + INSERT OR IGNORE dedup kick in naturally.
  it("derives scan.request_id from the user message uuid (capture parity)", () => {
    const result = scanFromTranscript({
      transcriptPath: TRANSCRIPT,
      globalClaudeMdPath: GLOBAL_CLAUDE_MD,
      homeDir: EMPTY_HOME,
    });
    expect(result).not.toBeNull();
    // minimal-session.jsonl's user entry has uuid "u-1".
    expect(result!.scan.request_id).toBe("u-1");
  });

  it("omits the global injected entry when globalClaudeMdPath does not exist", () => {
    const result = scanFromTranscript({
      transcriptPath: TRANSCRIPT,
      globalClaudeMdPath: "/tmp/oht-hook-fixture-no-global.md",
      homeDir: EMPTY_HOME,
    });
    expect(result).not.toBeNull();
    const { scan } = result!;
    expect(scan.injected_files.find((f) => f.category === "global")).toBeUndefined();
    expect(scan.injected_files).toHaveLength(1);
    expect(scan.injected_files[0].category).toBe("project");
  });
});

describe("scanFromTranscript with .claude disk scan (issue #363)", () => {
  let tmpProjectRoot: string;
  let tmpHomeRoot: string;
  let transcriptPath: string;
  let globalClaudeMdPath: string;

  beforeEach(() => {
    tmpProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "oht-363-proj-"),
    );
    tmpHomeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oht-363-home-"));

    fs.mkdirSync(path.join(tmpProjectRoot, ".claude/rules"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpProjectRoot, ".claude/rules/agent-browser-qa.md"),
      "<!-- canary:CANARY-agent-browser-qa -->\n# QA rule\nMandatory headed flow.",
    );
    fs.writeFileSync(
      path.join(tmpProjectRoot, ".claude/rules/sdd-workflow.md"),
      "# SDD workflow\nred-first vitest before implementation.",
    );

    fs.mkdirSync(path.join(tmpHomeRoot, ".claude/rules"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHomeRoot, ".claude/rules/global-style.md"),
      "# global style rule\nstuff",
    );

    globalClaudeMdPath = path.join(tmpHomeRoot, ".claude/CLAUDE.md");
    fs.writeFileSync(
      globalClaudeMdPath,
      "# Global CLAUDE.md\nglobal preferences",
    );

    const projectClaudeMd = path.join(tmpProjectRoot, "CLAUDE.md");
    fs.writeFileSync(projectClaudeMd, "# Project CLAUDE.md\nproject guide");

    const template = fs.readFileSync(CC2X_TEMPLATE, "utf-8");
    const rendered = template.split("__CWD_PLACEHOLDER__").join(tmpProjectRoot);
    transcriptPath = path.join(tmpProjectRoot, "session.jsonl");
    fs.writeFileSync(transcriptPath, rendered);
  });

  afterEach(() => {
    fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
    fs.rmSync(tmpHomeRoot, { recursive: true, force: true });
  });

  it("includes .claude/rules/*.md from both cwd and home in injected_files", () => {
    const result = scanFromTranscript({
      transcriptPath,
      globalClaudeMdPath,
      homeDir: tmpHomeRoot,
    });
    expect(result).not.toBeNull();
    const { scan } = result!;

    const paths = scan.injected_files.map((f) => f.path);
    expect(paths).toContain(
      path.join(tmpProjectRoot, ".claude/rules/agent-browser-qa.md"),
    );
    expect(paths).toContain(
      path.join(tmpProjectRoot, ".claude/rules/sdd-workflow.md"),
    );
    expect(paths).toContain(
      path.join(tmpHomeRoot, ".claude/rules/global-style.md"),
    );
    expect(paths).toContain(path.join(tmpProjectRoot, "CLAUDE.md"));
    expect(paths).toContain(globalClaudeMdPath);

    const rules = scan.injected_files.filter((f) => f.category === "rules");
    expect(rules).toHaveLength(3);
    for (const r of rules) {
      expect(r.estimated_tokens).toBeGreaterThan(0);
    }
  });

  it("dedupes when nested_memory and disk scan point to the same path (nested_memory wins)", () => {
    // Place a rule file at the exact path the transcript's nested_memory
    // attachment references (<cwd>/CLAUDE.md). The disk scan will only
    // walk .claude/{rules,memory,skills}, but to actually exercise the
    // dedup branch we plant a rule file whose path also appears in
    // nested_memories.
    const colliderPath = path.join(
      tmpProjectRoot,
      ".claude/rules/collider.md",
    );
    fs.writeFileSync(colliderPath, "# disk-scan version");
    const transcriptRaw = fs.readFileSync(transcriptPath, "utf-8");
    const colliderMemoryEntry = JSON.stringify({
      // Insert as child of a-cc2x-1 so it sits in the assistant's ancestry.
      parentUuid: "a-cc2x-1",
      isSidechain: false,
      attachment: {
        type: "nested_memory",
        path: colliderPath,
        content: {
          path: colliderPath,
          type: "Project",
          content: "# nested_memory version (wins on dedup)",
        },
      },
      type: "attachment",
      uuid: "a-cc2x-collider",
      timestamp: "2030-02-01T00:00:00.015Z",
      cwd: tmpProjectRoot,
      sessionId: "session-cc2x",
      version: "2.1.139",
      gitBranch: "main",
    });
    // Insert collider between a-cc2x-1 and the assistant entry, and rewrite
    // the assistant's parentUuid so the ancestry walk visits the collider.
    const rewritten = transcriptRaw
      .replace(
        /\n(\{"parentUuid":"a-cc2x-1")/,
        `\n${colliderMemoryEntry}\n$1`,
      )
      .replace(
        '"parentUuid":"a-cc2x-1","isSidechain":false,"message":{"model":"claude-test-model"',
        '"parentUuid":"a-cc2x-collider","isSidechain":false,"message":{"model":"claude-test-model"',
      );
    fs.writeFileSync(transcriptPath, rewritten);

    const result = scanFromTranscript({
      transcriptPath,
      globalClaudeMdPath,
      homeDir: tmpHomeRoot,
    });
    expect(result).not.toBeNull();
    const paths = result!.scan.injected_files.map((f) => f.path);
    const occurrences = paths.filter((p) => p === colliderPath).length;
    expect(occurrences).toBe(1);

    const collider = result!.scan.injected_files.find(
      (f) => f.path === colliderPath,
    );
    expect(collider).toBeDefined();
    // nested_memory's "Project" type maps to `project`; if dedup let the
    // disk-scan entry win it would be `rules`.
    expect(collider!.category).toBe("project");
  });

  it("excludes disk-scan entries from total_injected_tokens (only transcript-confirmed files count)", () => {
    const result = scanFromTranscript({
      transcriptPath,
      globalClaudeMdPath,
      homeDir: tmpHomeRoot,
    });
    expect(result).not.toBeNull();
    const { scan } = result!;
    const ruleTokens = scan.injected_files
      .filter((f) => f.category === "rules")
      .reduce((sum, f) => sum + f.estimated_tokens, 0);
    expect(ruleTokens).toBeGreaterThan(0);

    const confirmedTokens = scan.injected_files
      .filter((f) => f.category !== "rules" && f.category !== "skill" && f.category !== "memory")
      .reduce((sum, f) => sum + f.estimated_tokens, 0);
    expect(scan.total_injected_tokens).toBe(confirmedTokens);
    expect(scan.total_injected_tokens).toBeLessThan(
      scan.injected_files.reduce((sum, f) => sum + f.estimated_tokens, 0),
    );
  });

  it("survives when project .claude dir is absent (no rules in tmp project)", () => {
    fs.rmSync(path.join(tmpProjectRoot, ".claude"), {
      recursive: true,
      force: true,
    });
    const result = scanFromTranscript({
      transcriptPath,
      globalClaudeMdPath,
      homeDir: tmpHomeRoot,
    });
    expect(result).not.toBeNull();
    const rules = result!.scan.injected_files.filter(
      (f) => f.category === "rules",
    );
    // Only the global rule survives.
    expect(rules).toHaveLength(1);
    expect(rules[0].path).toBe(
      path.join(tmpHomeRoot, ".claude/rules/global-style.md"),
    );
  });

  it("survives when home .claude dir is absent (no rules in tmp home)", () => {
    fs.rmSync(path.join(tmpHomeRoot, ".claude"), {
      recursive: true,
      force: true,
    });
    const result = scanFromTranscript({
      transcriptPath,
      globalClaudeMdPath: "/tmp/oht-363-no-global.md",
      homeDir: tmpHomeRoot,
    });
    expect(result).not.toBeNull();
    const rules = result!.scan.injected_files.filter(
      (f) => f.category === "rules",
    );
    expect(rules).toHaveLength(2);
  });
});

// Issue #370: JSONL `cwd` is the session-start dir, NOT necessarily the
// project the LLM ended up working on. When the user starts CC from `~`
// but the LLM explores a different project, nested_memories paths under
// that project must seed disk-scan extra roots so the project's rule files
// are recovered even when CC did not inject all of them.
describe("scanFromTranscript with extra-root disk-scan (issue #370)", () => {
  let sessionCwd: string; // mimics `~` (no .claude/rules content)
  let effectiveProject: string; // the project the LLM actually worked on
  let tmpHomeRoot: string;
  let transcriptPath: string;

  beforeEach(() => {
    sessionCwd = fs.mkdtempSync(path.join(os.tmpdir(), "oht-370-cwd-"));
    effectiveProject = fs.mkdtempSync(
      path.join(os.tmpdir(), "oht-370-proj-"),
    );
    tmpHomeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oht-370-home-"));

    // The "effective project" has 3 rule files. CC will only inject one of
    // them via nested_memory (mimicking the 17/21 partial-injection case).
    fs.mkdirSync(path.join(effectiveProject, ".claude/rules"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(effectiveProject, ".claude/rules/auth-retry.md"),
      "# auth retry rule",
    );
    fs.writeFileSync(
      path.join(effectiveProject, ".claude/rules/tailwind.md"),
      "# tailwind rule",
    );
    fs.writeFileSync(
      path.join(effectiveProject, ".claude/rules/fsd.md"),
      "# fsd rule",
    );

    // Build a transcript whose cwd is `sessionCwd` (the wrong root for
    // disk-scan) but whose nested_memory points at one rule under
    // `effectiveProject`.
    const injectedRulePath = path.join(
      effectiveProject,
      ".claude/rules/auth-retry.md",
    );
    const lines = [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        promptId: "p-370-1",
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "how does tailwind work in this project?" }],
        },
        uuid: "u-370-1",
        timestamp: "2030-02-01T00:00:00.010Z",
        cwd: sessionCwd,
        sessionId: "session-370",
        version: "2.1.139",
        gitBranch: "main",
      }),
      JSON.stringify({
        parentUuid: "u-370-1",
        isSidechain: false,
        attachment: {
          type: "nested_memory",
          path: injectedRulePath,
          content: {
            path: injectedRulePath,
            type: "Project",
            content: "# auth retry rule",
          },
        },
        type: "attachment",
        uuid: "a-370-1",
        timestamp: "2030-02-01T00:00:00.020Z",
        cwd: sessionCwd,
        sessionId: "session-370",
        version: "2.1.139",
        gitBranch: "main",
      }),
      JSON.stringify({
        parentUuid: "a-370-1",
        isSidechain: false,
        message: {
          model: "claude-test-model",
          id: "msg-370-1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 2,
            service_tier: "standard",
          },
        },
        requestId: "req_011CbM5kdB6WD6Pr9SCEZTVE",
        type: "assistant",
        uuid: "as-370-1",
        timestamp: "2030-02-01T00:00:00.030Z",
        cwd: sessionCwd,
        sessionId: "session-370",
        version: "2.1.139",
        gitBranch: "main",
      }),
    ];
    transcriptPath = path.join(sessionCwd, "session.jsonl");
    fs.writeFileSync(transcriptPath, lines.join("\n") + "\n");
  });

  afterEach(() => {
    fs.rmSync(sessionCwd, { recursive: true, force: true });
    fs.rmSync(effectiveProject, { recursive: true, force: true });
    fs.rmSync(tmpHomeRoot, { recursive: true, force: true });
  });

  it("recovers project rule files via nested_memory paths even when cwd is unrelated", () => {
    const result = scanFromTranscript({
      transcriptPath,
      homeDir: tmpHomeRoot,
    });
    expect(result).not.toBeNull();
    const { scan } = result!;

    const paths = scan.injected_files.map((f) => f.path);
    // The CC-injected file is present (nested_memory seed).
    expect(paths).toContain(
      path.join(effectiveProject, ".claude/rules/auth-retry.md"),
    );
    // The two files CC did NOT inject must still be recovered via extraRoots.
    expect(paths).toContain(
      path.join(effectiveProject, ".claude/rules/tailwind.md"),
    );
    expect(paths).toContain(
      path.join(effectiveProject, ".claude/rules/fsd.md"),
    );

    // Files discovered through extraRoots get the dotClaudeScanner category
    // (`rules`), not the nested_memory fallback (`project`).
    const tailwind = scan.injected_files.find((f) =>
      f.path.endsWith(".claude/rules/tailwind.md"),
    );
    const fsd = scan.injected_files.find((f) =>
      f.path.endsWith(".claude/rules/fsd.md"),
    );
    expect(tailwind?.category).toBe("rules");
    expect(fsd?.category).toBe("rules");
  });
});
