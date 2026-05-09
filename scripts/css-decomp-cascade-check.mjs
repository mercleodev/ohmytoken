#!/usr/bin/env node
/**
 * css-decomp-cascade-check.mjs
 *
 * Post-build verifier for the dashboard CSS decomposition epic.
 *
 * The inventory generator (`scripts/css-decomp-inventory.mjs`) produces a
 * cascade-order baseline at `docs/sdd/css-decomp-inventory/selectors-ordered.txt`
 * snapshotting every selector in `dashboard.css` in declaration order. After
 * each implementation unit, classes move from `dashboard.css` into sibling or
 * `dashboard/_shared/` stylesheets. Vite concatenates these into a final
 * bundle whose effective cascade order is determined by import order in the
 * module graph — NOT by the order classes appeared in the original monolith.
 *
 * This script verifies that, after `npm run build`, the relative order of
 * any two moved selectors in the FINAL emitted CSS bundle matches their
 * relative order in the baseline. Same selector text + different cascade
 * order can produce different effective styles when specificity is equal,
 * so this check is required before declaring an implementation unit clean
 * (Codex v2 review blocking #6).
 *
 * Inputs (read-only):
 *   - dist/assets/*.css                                       (Vite prod bundle)
 *   - docs/sdd/css-decomp-inventory/selectors-ordered.txt.U1  (baseline; must
 *     be created in U1 by copying selectors-ordered.txt to .U1 right after
 *     the visual-baseline capture)
 *
 * Outputs (stdout + exit code):
 *   - exit 0 if cascade order is preserved
 *   - exit 1 with a diff report if any pair of moved selectors is reordered
 *   - exit 2 if dist/ is missing (run `npm run build` first)
 *   - exit 3 if the baseline is missing (run U1 first)
 *
 * Usage:
 *   npm run build
 *   node scripts/css-decomp-cascade-check.mjs
 *
 * Notes:
 *   - The script only checks selectors that DEFINE a class. @media,
 *     @keyframes, and pseudo-only selectors are skipped.
 *   - "Relative order" means: for every pair (A, B) of selectors that both
 *     appear in the baseline AND in the bundle, A precedes B in the bundle
 *     iff A precedes B in the baseline. We materialize this by computing
 *     the order rank of each selector in both lists and checking the
 *     longest-common-subsequence size; any mismatch is reported.
 *   - Reuses the CSS-parsing logic from css-decomp-inventory.mjs.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_ASSETS = join(ROOT, 'dist/assets');
const BASELINE_PATH = join(
  ROOT,
  'docs/sdd/css-decomp-inventory/selectors-ordered.txt.U1',
);

// ---------- CSS parsing (same heuristic as the inventory generator) ----------

function stripCssComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function extractSelectors(content) {
  const stripped = stripCssComments(content);
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') {
      if (depth === 0) {
        const selectorText = buf.trim();
        if (selectorText && !selectorText.startsWith('@')) {
          for (const part of selectorText.split(',')) {
            const raw = part.trim();
            if (!raw) continue;
            const classes = [...raw.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
            if (classes.length > 0) out.push({ raw, classes });
          }
        }
        buf = '';
      }
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) buf = '';
      continue;
    }
    if (depth === 0) buf += ch;
  }
  return out;
}

// ---------- Baseline parsing ----------

function parseBaseline(content) {
  const out = [];
  for (const line of content.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const raw = line.slice(tab + 1).trim();
    if (!raw || raw.startsWith('@')) continue;
    const classes = [...raw.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    if (classes.length > 0) out.push({ raw, classes });
  }
  return out;
}

// ---------- Bundle aggregation ----------

async function listDistCssFiles() {
  let entries;
  try {
    entries = await readdir(DIST_ASSETS, { withFileTypes: true });
  } catch {
    return null;
  }
  const cssFiles = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.css')) {
      cssFiles.push(join(DIST_ASSETS, entry.name));
    }
  }
  return cssFiles.sort();
}

async function aggregateBundleSelectors(cssFiles) {
  const out = [];
  for (const file of cssFiles) {
    const content = await readFile(file, 'utf8');
    const selectors = extractSelectors(content);
    for (const sel of selectors) out.push({ ...sel, source: relative(ROOT, file) });
  }
  return out;
}

// ---------- Comparison ----------

/**
 * Compute longest common subsequence length between two arrays.
 * Used to detect cascade-order disagreement: if LCS length < min(len(A), len(B))
 * we know at least one pair has been reordered.
 */
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function selectorKey(sel) {
  // Canonicalize so a hand-written baseline (`.a > .b:HOVER`) and a Vite-
  // minified bundle (`.a>.b:hover`) compare equal:
  //   1. collapse whitespace around combinators (>, +, ~)
  //   2. lowercase pseudo-classes / pseudo-elements
  //   3. normalize remaining whitespace runs to a single space, trim
  // Without this canonicalization, false negatives (FAIL where order is
  // actually preserved) and false positives (silent PASS via empty
  // intersection) are both reachable. Per gate doc §3 C7 this script is the
  // contract authority for cascade preservation.
  //
  // Known residual gaps (low likelihood for the current dashboard.css surface,
  // but worth a follow-up if a future move touches them):
  //   - whitespace inside attribute selectors is NOT stripped, so
  //     `[data-x = "Foo"]` and `[data-x="Foo"]` would not equate.
  //   - whitespace inside functional pseudo args is NOT stripped, so
  //     `:not( .a )` and `:not(.a)` would not equate.
  // If either pattern lands in dashboard.css, extend this canonicalizer.
  return sel.raw
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/(::?[a-zA-Z][a-zA-Z0-9-]*)/g, (m) => m.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

function findReorderings(baseline, bundle) {
  const baselineKeys = baseline.map(selectorKey);
  const bundleKeys = bundle.map(selectorKey);

  // Restrict to keys present in both lists; that is the comparable set.
  const baselineSet = new Set(baselineKeys);
  const bundleSet = new Set(bundleKeys);
  const baselineComparable = baselineKeys.filter((k) => bundleSet.has(k));
  const bundleComparable = bundleKeys.filter((k) => baselineSet.has(k));

  // Empty-intersection guard. With a misconfigured baseline path or after a
  // catastrophic build (no dashboard.css selectors emitted at all), every
  // count drops to zero and the LCS check would silently report PASS via
  // `0 === 0 === 0`. Treat this as a configuration failure, not a passing
  // cascade order.
  if (baselineComparable.length === 0 || bundleComparable.length === 0) {
    return {
      ok: false,
      comparableCount: 0,
      lcs: 0,
      bundleOnly: bundleKeys.length,
      baselineOnly: baselineKeys.length,
      firstDivergence: null,
      emptyIntersection: true,
    };
  }

  const lcs = lcsLength(baselineComparable, bundleComparable);
  const ok = lcs === baselineComparable.length && lcs === bundleComparable.length;

  // For diagnostics: pinpoint the first divergence.
  let firstDivergence = null;
  if (!ok) {
    // Walk both comparable lists and find the first index where they differ
    // when projected onto each other's order.
    const baselineIndex = new Map();
    baselineComparable.forEach((k, i) => baselineIndex.set(k, i));
    let lastBaselineRank = -1;
    for (let j = 0; j < bundleComparable.length; j++) {
      const k = bundleComparable[j];
      const r = baselineIndex.get(k);
      if (r === undefined) continue;
      if (r < lastBaselineRank) {
        firstDivergence = {
          bundleIndex: j,
          bundleKey: k,
          expectedAfter: baselineComparable[lastBaselineRank],
        };
        break;
      }
      lastBaselineRank = r;
    }
  }

  return {
    ok,
    comparableCount: baselineComparable.length,
    lcs,
    bundleOnly: bundleKeys.filter((k) => !baselineSet.has(k)).length,
    baselineOnly: baselineKeys.filter((k) => !bundleSet.has(k)).length,
    firstDivergence,
  };
}

// ---------- Main ----------

async function main() {
  // Check baseline
  let baselineRaw;
  try {
    baselineRaw = await readFile(BASELINE_PATH, 'utf8');
  } catch {
    console.error(`ERROR: baseline not found at ${relative(ROOT, BASELINE_PATH)}`);
    console.error(
      'Run U1 first and copy selectors-ordered.txt to selectors-ordered.txt.U1 (immutable baseline).',
    );
    process.exit(3);
  }
  const baseline = parseBaseline(baselineRaw);
  if (baseline.length === 0) {
    console.error(`ERROR: baseline is empty: ${relative(ROOT, BASELINE_PATH)}`);
    process.exit(3);
  }

  // Check dist
  const cssFiles = await listDistCssFiles();
  if (cssFiles === null) {
    console.error(`ERROR: ${relative(ROOT, DIST_ASSETS)}/ not found.`);
    console.error('Run `npm run build` first.');
    process.exit(2);
  }
  if (cssFiles.length === 0) {
    console.error(`ERROR: no .css files under ${relative(ROOT, DIST_ASSETS)}/`);
    console.error('Run `npm run build` first.');
    process.exit(2);
  }

  const bundle = await aggregateBundleSelectors(cssFiles);

  console.log('-- css-decomp-cascade-check --');
  console.log(`Baseline: ${relative(ROOT, BASELINE_PATH)}`);
  console.log(`  selector entries: ${baseline.length}`);
  console.log(`Bundle (dist/assets/):`);
  for (const f of cssFiles) {
    console.log(`  ${relative(ROOT, f)}`);
  }
  console.log(`  selector entries: ${bundle.length}`);

  const result = findReorderings(baseline, bundle);

  console.log(`Comparable selectors (in both lists): ${result.comparableCount}`);
  console.log(`Longest common subsequence:           ${result.lcs}`);
  console.log(`Selectors only in bundle (new files): ${result.bundleOnly}`);
  console.log(`Selectors only in baseline (removed): ${result.baselineOnly}`);

  if (result.emptyIntersection) {
    console.log('CASCADE ORDER: FAIL');
    console.log(
      'Empty selector intersection between baseline and bundle.',
    );
    console.log(
      'Likely cause: misconfigured baseline path, wrong dist/ assets, or',
    );
    console.log(
      'a build that emitted no dashboard.css selectors at all. Verify',
    );
    console.log(
      `${relative(ROOT, BASELINE_PATH)} exists and \`npm run build\` produced`,
    );
    console.log(`  ${relative(ROOT, DIST_ASSETS)}/*.css with the expected content.`);
    process.exit(1);
  }

  if (result.ok) {
    console.log('CASCADE ORDER: PASS');
    process.exit(0);
  }

  console.log('CASCADE ORDER: FAIL');
  if (result.firstDivergence) {
    console.log('First divergence:');
    console.log(`  bundle index: ${result.firstDivergence.bundleIndex}`);
    console.log(`  bundle key:   ${result.firstDivergence.bundleKey}`);
    console.log(
      `  expected (baseline) AFTER: ${result.firstDivergence.expectedAfter}`,
    );
  }
  console.log('');
  console.log('Remediation:');
  console.log('  1. Inspect the consumer that imported the offending selector last.');
  console.log('  2. Confirm the import order is: _shared/* → cluster → component-local.');
  console.log('  3. If the order is correct but the selector still moved, the offending');
  console.log('     unit must be reverted (L5 in §11 of the gate doc).');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(4);
});
