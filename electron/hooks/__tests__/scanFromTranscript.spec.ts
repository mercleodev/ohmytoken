import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanFromTranscript } from "../scanFromTranscript";

const TRANSCRIPT = path.join(__dirname, "fixtures", "minimal-session.jsonl");
const GLOBAL_CLAUDE_MD = path.join(__dirname, "fixtures", "global-CLAUDE.md");

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
