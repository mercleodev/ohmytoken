import { describe, it, expect } from "vitest";
import { deriveExtraRoots } from "../deriveExtraRoots";

describe("deriveExtraRoots", () => {
  it("returns the project root for a path containing /.claude/", () => {
    const out = deriveExtraRoots([
      "/proj/web/.claude/rules/tailwind.md",
    ]);
    expect(out).toEqual(["/proj/web"]);
  });

  it("dedupes multiple paths under the same project root", () => {
    const out = deriveExtraRoots([
      "/proj/web/.claude/rules/a.md",
      "/proj/web/.claude/rules/b.md",
      "/proj/web/.claude/memory/c.md",
    ]);
    expect(out).toEqual(["/proj/web"]);
  });

  it("returns multiple roots when paths belong to distinct projects", () => {
    const out = deriveExtraRoots([
      "/proj/web/.claude/rules/a.md",
      "/proj/oht/.claude/rules/b.md",
    ]);
    expect(out.sort()).toEqual([
      "/proj/oht",
      "/proj/web",
    ]);
  });

  it("skips paths without a /.claude/ segment", () => {
    const out = deriveExtraRoots([
      "/tmp/random.md",
      "/proj/web/.claude/rules/a.md",
      "",
    ]);
    expect(out).toEqual(["/proj/web"]);
  });

  it("returns an empty array for an empty iterable", () => {
    expect(deriveExtraRoots([])).toEqual([]);
  });

  it("uses the LAST /.claude/ boundary to handle nested fixture trees", () => {
    // Edge case: a path that itself contains /.claude/ deeper. We always
    // strip at the rightmost boundary so the helper still walks the
    // closest enclosing project.
    const out = deriveExtraRoots([
      "/u/.claude/projects/work/.claude/rules/a.md",
    ]);
    expect(out).toEqual(["/u/.claude/projects/work"]);
  });
});
