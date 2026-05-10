import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { scanFromTranscript } from "../scanFromTranscript";

const TRANSCRIPT = path.join(__dirname, "fixtures", "minimal-session.jsonl");
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
});

afterAll(() => {
  try {
    fs.unlinkSync(GLOBAL_CLAUDE_MD);
  } catch {
    /* ignore missing tmp file */
  }
});

describe("scanFromTranscript", () => {
  it("returns null when the transcript file is missing", () => {
    expect(
      scanFromTranscript({
        transcriptPath: "/tmp/oht-hook-fixture-missing.jsonl",
        globalClaudeMdPath: GLOBAL_CLAUDE_MD,
      }),
    ).toBeNull();
  });

  it("builds a PromptScan from the latest turn with project + global injected files and Anthropic-reported usage", () => {
    const result = scanFromTranscript({
      transcriptPath: TRANSCRIPT,
      globalClaudeMdPath: GLOBAL_CLAUDE_MD,
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

  it("omits the global injected entry when globalClaudeMdPath does not exist", () => {
    const result = scanFromTranscript({
      transcriptPath: TRANSCRIPT,
      globalClaudeMdPath: "/tmp/oht-hook-fixture-no-global.md",
    });
    expect(result).not.toBeNull();
    const { scan } = result!;
    expect(scan.injected_files.find((f) => f.category === "global")).toBeUndefined();
    expect(scan.injected_files).toHaveLength(1);
    expect(scan.injected_files[0].category).toBe("project");
  });
});
