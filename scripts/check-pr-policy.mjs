#!/usr/bin/env node
import fs from "node:fs";

function fail(message) {
  console.error(`[pr-policy] FAIL: ${message}`);
  process.exit(1);
}

function getSection(body, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`##\\s*${escaped}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const match = body.match(re);
  return match ? match[1] : "";
}

function parseArgs(argv) {
  const result = {
    bodyFile: "",
    stdin: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stdin") {
      result.stdin = true;
      continue;
    }
    if (arg === "--body-file") {
      result.bodyFile = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--body-file=")) {
      result.bodyFile = arg.slice("--body-file=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/check-pr-policy.mjs [--stdin] [--body-file <path>]",
      );
      process.exit(0);
    }
  }

  return result;
}

function loadBody(args) {
  if (args.bodyFile) {
    if (!fs.existsSync(args.bodyFile)) {
      fail(`Body file not found: ${args.bodyFile}`);
    }
    return fs.readFileSync(args.bodyFile, "utf8");
  }

  if (args.stdin) {
    return fs.readFileSync(0, "utf8");
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.log("[pr-policy] INFO: GITHUB_EVENT_PATH not found, skipping.");
    process.exit(0);
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const pr = payload.pull_request;
  if (!pr) {
    console.log("[pr-policy] INFO: no pull_request payload, skipping.");
    process.exit(0);
  }

  return pr.body || "";
}

function getChecklistLines(section) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ["));
}

function requireCheckedChecklist(sectionName, sectionBody) {
  const lines = getChecklistLines(sectionBody);
  if (lines.length === 0) {
    fail(`\`${sectionName}\` section must contain checklist items.`);
  }
  const unchecked = lines.filter((line) => /^- \[ \]/.test(line));
  if (unchecked.length > 0) {
    fail(
      `Unchecked \`${sectionName}\` checklist items found:\n${unchecked.join("\n")}`,
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const body = loadBody(args);
const requiredSections = [
  "Summary",
  "Linked Issue",
  "Reuse Plan",
  "Applicable Rules",
  "Scope",
  "Execution Authorization",
  "Validation",
  "Test Evidence",
  "Docs",
  "Risk and Rollback",
];

for (const sectionName of requiredSections) {
  if (!getSection(body, sectionName)) {
    fail(`Missing \`## ${sectionName}\` section.`);
  }
}

if (/Generated with\s+\[?Claude Code\]?/i.test(body)) {
  fail("Remove `Generated with Claude Code` branding from PR body.");
}

if (/Describe what changed and why\./i.test(body)) {
  fail("`## Summary` still contains template placeholder text.");
}

if (/List potential risks and rollback steps\./i.test(body)) {
  fail("`## Risk and Rollback` still contains template placeholder text.");
}

if (/<example>|<path|<tests\/scenarios\/logs>/i.test(body)) {
  fail("PR body still contains template placeholders.");
}

const linkedIssueSection = getSection(body, "Linked Issue");
if (!/Closes\s+#\d+/i.test(linkedIssueSection)) {
  fail("`## Linked Issue` must include at least one `Closes #<number>` entry.");
}

if (/Closes\s+#\s*$/im.test(linkedIssueSection)) {
  fail("`## Linked Issue` still contains unresolved `Closes #` placeholder.");
}

const reuseSection = getSection(body, "Reuse Plan");
const reuseChecklistLines = getChecklistLines(reuseSection);

if (reuseChecklistLines.length === 0) {
  fail("`Reuse Plan` section must contain checklist items.");
}

const uncheckedReuse = reuseChecklistLines.filter((line) => /^- \[ \]/.test(line));
if (uncheckedReuse.length > 0) {
  fail(`Unchecked reuse-plan items found:\n${uncheckedReuse.join("\n")}`);
}

if (/<example>|<path|<tests\/scenarios\/logs>/i.test(reuseSection)) {
  fail("`Reuse Plan` still contains template placeholders. Replace with real content.");
}

const noMigration = /N\/A\s*\((?:no migration|not applicable|greenfield)\)/i.test(
  reuseSection,
);

if (!noMigration && !/\bchecktoken\b/i.test(reuseSection)) {
  fail(
    "`Reuse Plan` must reference checktoken baseline source, or explicitly mark `N/A (no migration)`.",
  );
}

if (!noMigration) {
  const matrixRows = reuseSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  const matrixDataRows = matrixRows.filter(
    (line) =>
      !/^\|\s*---/i.test(line) &&
      !/^\|\s*Target Area\b/i.test(line) &&
      /[A-Za-z0-9]/.test(line.replaceAll("|", "")),
  );

  if (matrixDataRows.length === 0) {
    fail("`Reuse Plan` must include at least one Decision Matrix data row.");
  }

  if (!matrixDataRows.some((line) => /\b(reuse|adapt|rewrite)\b/i.test(line))) {
    fail("Decision Matrix must classify target areas as Reuse/Adapt/Rewrite.");
  }

  if (!/(src\/|electron\/|\.tsx?|\.jsx?|\.json|\.md|\.yml|\.yaml)/i.test(reuseSection)) {
    fail("`Reuse Plan` must include checktoken-to-OhMyToken path mapping evidence.");
  }
}

if (!/(Rewrite|rewrite)/.test(reuseSection)) {
  fail("`Reuse Plan` must explicitly mention rewrite handling.");
}

if (!/(justification|reason|N\/A)/i.test(reuseSection)) {
  fail("`Reuse Plan` must include rewrite justification or explicit N/A.");
}

const applicableSection = getSection(body, "Applicable Rules");
const checklistLines = getChecklistLines(applicableSection);

if (checklistLines.length === 0) {
  fail("`Applicable Rules` section must contain checklist items.");
}

const unchecked = checklistLines.filter((line) => /^- \[ \]/.test(line));
if (unchecked.length > 0) {
  fail(`Unchecked rule references found:\n${unchecked.join("\n")}`);
}

const invalidRefs = checklistLines.filter(
  (line) => !line.includes(".md") || !line.includes("\u00A7"),
);
if (invalidRefs.length > 0) {
  fail(
    "Each checked applicable rule must include doc + section reference (`.md` and `\u00A7`).",
  );
}

const requiredDocs = [
  "CONTRIBUTING.md",
  "OPEN-SOURCE-WORKFLOW.md",
];
for (const doc of requiredDocs) {
  if (!checklistLines.some((line) => line.includes(doc))) {
    fail(`Missing required applicable rule reference for ${doc}.`);
  }
}

const validationSection = getSection(body, "Validation");
requireCheckedChecklist("Scope", getSection(body, "Scope"));
requireCheckedChecklist(
  "Execution Authorization",
  getSection(body, "Execution Authorization"),
);
requireCheckedChecklist("Validation", validationSection);
requireCheckedChecklist("Docs", getSection(body, "Docs"));

console.log("[pr-policy] PASS");
