#!/usr/bin/env node
/* eslint-env node */
/**
 * Smoke / integration evidence for issue #363.
 *
 * Loads the freshly-built dist-electron scanner and runs it against the
 * latest CC 2.x transcript from the current ohmytoken project, then
 * prints the captured `injected_files` so we can see that disk-scanned
 * rule files reach the candidate pool (the gap report #406 exposed).
 */
import path from "node:path";
import os from "node:os";
import { scanFromTranscript } from "../../../../dist-electron/hooks/scanFromTranscript.js";

const projectsDir = path.join(
  os.homedir(),
  ".claude",
  "projects",
  "-Users-gimhyeonglae-Desktop-pjt-ohmytoken",
);

import fs from "node:fs";
const candidates = fs
  .readdirSync(projectsDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
  .map((e) => ({
    name: e.name,
    mtime: fs.statSync(path.join(projectsDir, e.name)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime);

if (candidates.length === 0) {
  console.error("no jsonl found under", projectsDir);
  process.exit(2);
}

const transcriptPath = path.join(projectsDir, candidates[0].name);
console.log("transcript:", transcriptPath);

const globalClaudeMd = path.join(os.homedir(), ".claude", "CLAUDE.md");

const result = scanFromTranscript({
  transcriptPath,
  globalClaudeMdPath: globalClaudeMd,
});

if (!result) {
  console.error("scanFromTranscript returned null");
  process.exit(3);
}

const { scan } = result;
console.log("session_id:", scan.session_id);
console.log("project_path (cwd):", scan.project_path);
console.log("model:", scan.model);
console.log("total_injected_tokens:", scan.total_injected_tokens);
console.log("");
console.log("injected_files (" + scan.injected_files.length + "):");
for (const f of scan.injected_files) {
  console.log(`  [${f.category.padEnd(8)}] ${f.estimated_tokens.toString().padStart(6)} tok  ${f.path}`);
}
