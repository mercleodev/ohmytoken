/**
 * Issue #376 — history-detail IPC parity.
 *
 * Verifies that `buildHistoryDetailFiles` recovers an external cwd's
 * `.claude/{rules,memory,skills}` and `CLAUDE.md` even when JSONL
 * `projectPath` is empty, by routing through `applyDiskScanCandidates`
 * + `deriveExtraRoots(nestedMemoryPaths)`. This is the regression case
 * captured in DB rows 4204/4273.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildHistoryDetailFiles } from "../buildHistoryDetailFiles";

let tmpRoot: string;
let homeDir: string;
let externalProjectRoot: string;

const writeFile = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omt-376-"));
  homeDir = path.join(tmpRoot, "fake-home");
  externalProjectRoot = path.join(tmpRoot, "ext-proj");

  // Global config (always present)
  writeFile(path.join(homeDir, ".claude", "CLAUDE.md"), "# global\n");

  // Per-session memory cache
  writeFile(
    path.join(
      homeDir,
      ".claude",
      "projects",
      "-ext-proj",
      "memory",
      "MEMORY.md",
    ),
    "# session memory\n",
  );

  // External project: full rules/skills/memory tree
  writeFile(path.join(externalProjectRoot, "CLAUDE.md"), "# ext project\n");
  writeFile(
    path.join(externalProjectRoot, ".claude", "rules", "alpha.md"),
    "# alpha\n",
  );
  writeFile(
    path.join(externalProjectRoot, ".claude", "rules", "bravo.md"),
    "# bravo\n",
  );
  writeFile(
    path.join(externalProjectRoot, ".claude", "memory", "notes.md"),
    "# notes\n",
  );
  writeFile(
    path.join(externalProjectRoot, ".claude", "skills", "demo", "SKILL.md"),
    "# demo skill\n",
  );
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("buildHistoryDetailFiles — issue #376", () => {
  it("recovers external cwd .claude/* when projectPath is empty and nested_memory paths point there", () => {
    const nestedMemoryPaths = [
      path.join(externalProjectRoot, ".claude", "rules", "alpha.md"),
    ];

    const result = buildHistoryDetailFiles({
      projectPath: undefined,
      homeDir,
      projectDirName: "-ext-proj",
      nestedMemoryPaths,
    });

    const paths = result.map((f) => f.path);

    // External .claude/* must be recovered via deriveExtraRoots + disk scan.
    expect(paths).toContain(
      path.join(externalProjectRoot, ".claude", "rules", "alpha.md"),
    );
    expect(paths).toContain(
      path.join(externalProjectRoot, ".claude", "rules", "bravo.md"),
    );
    expect(paths).toContain(
      path.join(externalProjectRoot, ".claude", "memory", "notes.md"),
    );
    expect(paths).toContain(
      path.join(externalProjectRoot, ".claude", "skills", "demo", "SKILL.md"),
    );

    // Global + per-session memory still present.
    expect(paths).toContain(path.join(homeDir, ".claude", "CLAUDE.md"));
    expect(paths).toContain(
      path.join(
        homeDir,
        ".claude",
        "projects",
        "-ext-proj",
        "memory",
        "MEMORY.md",
      ),
    );
  });

  it("scans projectPath directly when JSONL cwd matches the project", () => {
    const result = buildHistoryDetailFiles({
      projectPath: externalProjectRoot,
      homeDir,
      projectDirName: "-ext-proj",
      nestedMemoryPaths: [],
    });

    const paths = result.map((f) => f.path);
    expect(paths).toContain(path.join(externalProjectRoot, "CLAUDE.md"));
    expect(paths).toContain(
      path.join(externalProjectRoot, ".claude", "rules", "alpha.md"),
    );
    expect(paths).toContain(
      path.join(externalProjectRoot, ".claude", "rules", "bravo.md"),
    );
    expect(paths).toContain(
      path.join(externalProjectRoot, ".claude", "skills", "demo", "SKILL.md"),
    );
  });

  it("classifies recovered files into rules/memory/skill/project/global", () => {
    const result = buildHistoryDetailFiles({
      projectPath: undefined,
      homeDir,
      projectDirName: "-ext-proj",
      nestedMemoryPaths: [
        path.join(externalProjectRoot, ".claude", "rules", "alpha.md"),
      ],
    });

    const byPath = new Map(result.map((f) => [f.path, f.category]));
    expect(byPath.get(path.join(homeDir, ".claude", "CLAUDE.md"))).toBe("global");
    expect(
      byPath.get(path.join(externalProjectRoot, ".claude", "rules", "alpha.md")),
    ).toBe("rules");
    expect(
      byPath.get(
        path.join(externalProjectRoot, ".claude", "memory", "notes.md"),
      ),
    ).toBe("memory");
    expect(
      byPath.get(
        path.join(externalProjectRoot, ".claude", "skills", "demo", "SKILL.md"),
      ),
    ).toBe("skill");
    expect(
      byPath.get(
        path.join(
          homeDir,
          ".claude",
          "projects",
          "-ext-proj",
          "memory",
          "MEMORY.md",
        ),
      ),
    ).toBe("memory");
  });

  it("returns only global + session memory when nested_memory paths give no extra root and projectPath is empty", () => {
    const result = buildHistoryDetailFiles({
      projectPath: undefined,
      homeDir,
      projectDirName: "-ext-proj",
      nestedMemoryPaths: [],
    });

    const paths = result.map((f) => f.path);
    // Reproduces the 4204/4273 broken state — without nested_memory hints
    // and without a projectPath, we cannot infer the external root.
    expect(paths).toContain(path.join(homeDir, ".claude", "CLAUDE.md"));
    expect(paths).toContain(
      path.join(
        homeDir,
        ".claude",
        "projects",
        "-ext-proj",
        "memory",
        "MEMORY.md",
      ),
    );
    // External rules NOT recovered — this is the pre-fix behaviour and is
    // documented to ensure the helper is honest about its inputs.
    expect(
      paths.includes(
        path.join(externalProjectRoot, ".claude", "rules", "alpha.md"),
      ),
    ).toBe(false);
  });
});
