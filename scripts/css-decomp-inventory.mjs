#!/usr/bin/env node
/**
 * css-decomp-inventory.mjs (v3)
 *
 * Static-analysis inventory generator for the dashboard CSS decomposition
 * epic (`docs/sdd/dashboard-css-decomposition-gate.md`).
 *
 * Inputs (read-only):
 *   - src/components/dashboard/dashboard.css       (the monolith under decomposition)
 *   - src/components/notification/notification.css (collision target)
 *   - src/App.css, src/components/TokenTreemap.css (peers — class-name overlap check)
 *   - src/**\/*.tsx, src/**\/*.ts                   (consumer scan)
 *   - scripts/css-decomp-overrides.json             (manual consumer mapping for
 *                                                    classes the static analyzer
 *                                                    cannot resolve)
 *
 * Outputs (written under docs/sdd/css-decomp-inventory/):
 *   - class-consumers.json   structured inventory: class -> {firstLine, consumers, tier}
 *   - class-consumers.md     human-readable inventory grouped by tier
 *   - selectors-ordered.txt  every selector in dashboard.css in declaration order
 *                            (the cascade-order baseline; preserves duplicates)
 *   - prefix-summary.md      prefix -> {classCount, distinctConsumerFolders}
 *   - collisions.md          classes defined in both dashboard.css and notification.css
 *                            and other peers
 *   - orphans.md             3-way orphan classification:
 *                              true-orphan-candidate
 *                              compound-modifier-unresolved
 *                              dynamic-pattern-unresolved
 *
 * Tier classification rules:
 *   single-owner: exactly one consumer file (Tier 1 candidate)
 *   cluster:      multiple consumers, all within a single component subtree
 *                 (e.g. all under src/components/dashboard/, or all under
 *                  src/components/dashboard/prompt-detail/)
 *   shared:       multiple consumers spread across two or more component subtrees
 *                 (Tier 3: must move to src/components/dashboard/_shared/ and be
 *                  imported explicitly by every consumer; the _shared/ directory
 *                  lives under dashboard/ because no class actually crosses the
 *                  dashboard boundary in the current inventory)
 *   orphan:       zero consumers found by static analysis. Sub-classified into:
 *                 - true-orphan-candidate: no plausible runtime usage detected
 *                 - compound-modifier-unresolved: short modifier-like name
 *                   (e.g. .active, .expanded) that is likely composed at runtime
 *                   into "<base> <modifier>" but the static scan could not link it
 *                 - dynamic-pattern-unresolved: BEM-style modifier (--info) or
 *                   suffix-based class likely produced via `prefix-${variant}`
 *                 Only `true-orphan-candidate` is eligible for the U50
 *                 `/* UNUSED candidate * /` marker; the other two buckets must be
 *                 manually verified before any deletion.
 *
 * Static-analysis caveats:
 *   - Phase A: captures className="..." string literals, className={`...`}
 *     template literals (with ${...} stripped), and string args to
 *     classNames() / cn() / clsx().
 *   - Phase B: NEW in v3. Broad string-literal scan across all .ts/.tsx files.
 *     Every "..." / '...' / `...` literal is split on whitespace; tokens that
 *     match a class defined in dashboard.css are added as consumers. This
 *     catches helper-returned static class strings (e.g. ProviderTabs returning
 *     "provider-tab-dot tracking-active") that Phase A would miss.
 *   - Phase C: NEW in v3. scripts/css-decomp-overrides.json manualConsumers
 *     entries are merged in as the final pass. Use sparingly — every entry
 *     should be re-validated by the dead-CSS follow-up issue.
 *   - Does NOT resolve runtime concatenation (`base + "-" + variant`) without
 *     an override entry.
 *   - Does NOT scan multi-line template literals — Phase B's literal-extraction
 *     regexes deliberately stop at the first newline inside double/single
 *     quotes. Multi-line template literals (rare for class composition) are
 *     a known gap; add an override for any class that needs them.
 *   - Does NOT inspect node_modules or __tests__/.
 *   - Comments are stripped before token extraction to avoid false positives.
 *
 * Usage:
 *   node scripts/css-decomp-inventory.mjs
 *
 * Exit codes:
 *   0  inventory generated
 *   1  unrecoverable error (missing input file, write failure, malformed override)
 */

import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * Modifier words used by classifyOrphan() to detect compound-modifier
 * patterns. These are class-name fragments that, when seen in isolation
 * without a static consumer, are most likely composed at runtime via
 * `className={`${base} ${modifier}`}`. Source: hand-curated from the current
 * dashboard.css orphan list. Tuning cost: a false-negative here means a
 * class is classified as `true-orphan-candidate` and therefore eligible for
 * the U50 `/* UNUSED candidate * /` marker — which could lead to deletion
 * of a runtime-composed class. Lift here so it is greppable.
 *
 * Curation policy: each entry MUST be a class-name suffix actually observed
 * in `dashboard.css`. Do not add speculative entries — a false positive (an
 * unrelated class wrongly classified as a runtime modifier) hides a genuine
 * orphan from U50 review. When tuning, run the inventory generator and
 * verify the orphan diff before/after the change.
 */
const MODIFIER_WORDS = new Set([
  'active', 'inactive',
  'open', 'closed',
  'expanded', 'collapsed',
  'enabled', 'disabled',
  'loading', 'loaded',
  'pending', 'ready', 'complete', 'completed',
  'selected', 'unselected',
  'hovered', 'focused',
  'success', 'error', 'warning', 'info',
  'clickable', 'editable', 'draggable',
  'copied', 'saved',
  'connected', 'disconnected', 'attention', 'optional',
  'on', 'off',
  'tracking', 'unverified', 'confirmed', 'likely',
  'small', 'large',
]);

const DASHBOARD_CSS = join(ROOT, 'src/components/dashboard/dashboard.css');
const NOTIFICATION_CSS = join(ROOT, 'src/components/notification/notification.css');
const APP_CSS = join(ROOT, 'src/App.css');
const TOKEN_TREEMAP_CSS = join(ROOT, 'src/components/TokenTreemap.css');
const SRC_DIR = join(ROOT, 'src');
const OUT_DIR = join(ROOT, 'docs/sdd/css-decomp-inventory');
const OVERRIDES_PATH = join(ROOT, 'scripts/css-decomp-overrides.json');

// ---------- CSS parsing ----------

function stripCssComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Extract every selector that opens a rule block in declaration order.
 * Returns: [{ line, raw, classes: string[] }]
 *
 * Walks character-by-character tracking brace depth. When `{` is encountered at
 * depth 0, the buffered text since the last `}` is one or more selectors
 * separated by `,`. Each selector is split out and its `.classname` tokens are
 * extracted via regex.
 *
 * Lines are 1-indexed.
 */
function extractSelectors(content) {
  const stripped = stripCssComments(content);
  const out = [];
  let depth = 0;
  let buf = '';
  let bufStartLine = 1;
  let line = 1;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '\n') line++;
    if (ch === '{') {
      if (depth === 0) {
        const selectorText = buf.trim();
        if (selectorText && !selectorText.startsWith('@')) {
          for (const part of selectorText.split(',')) {
            const raw = part.trim();
            if (!raw) continue;
            const classes = [...raw.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
            out.push({ line: bufStartLine, raw, classes });
          }
        } else if (selectorText.startsWith('@')) {
          // Track @media / @supports / @keyframes blocks but record their
          // header lines as plain entries with no classes so cascade-order
          // baseline preserves them.
          out.push({ line: bufStartLine, raw: selectorText, classes: [] });
        }
        buf = '';
        bufStartLine = line;
      }
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        buf = '';
        bufStartLine = line;
      }
      continue;
    }
    if (depth === 0) {
      if (buf === '' && ch.trim() !== '') bufStartLine = line;
      buf += ch;
    }
  }
  return out;
}

// ---------- TSX/TS parsing ----------

function stripTsComments(content) {
  let out = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  return out;
}

/**
 * Phase A: className-attribute-specific class extraction.
 * Captures only tokens that appear inside className="..." / className={`...`} /
 * classNames|cn|clsx(...) call arguments.
 */
function extractClassTokens(content) {
  const stripped = stripTsComments(content);
  const tokens = new Set();

  for (const m of stripped.matchAll(/className\s*=\s*"([^"]+)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  }
  for (const m of stripped.matchAll(/className\s*=\s*'([^']+)'/g)) {
    for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  }
  for (const m of stripped.matchAll(/className\s*=\s*\{`([^`]*)`\}/g)) {
    const staticOnly = m[1].replace(/\$\{[^}]*\}/g, ' ');
    for (const t of staticOnly.split(/\s+/)) if (t) tokens.add(t);
  }
  for (const m of stripped.matchAll(/(?:classNames|cn|clsx)\s*\(([\s\S]*?)\)/g)) {
    for (const sm of m[1].matchAll(/["']([^"']+)["']/g)) {
      for (const t of sm[1].split(/\s+/)) if (t) tokens.add(t);
    }
  }
  for (const m of stripped.matchAll(/\bclass\s*=\s*"([^"]+)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  }

  return [...tokens];
}

/**
 * Phase B (NEW v3): broad string-literal scan, filtered against the dashboard
 * class set. Catches helper-returned class strings such as
 *   const dotClass = `provider-tab-dot tracking-${state}`;
 *   return `${base} account-connected`;
 * which Phase A misses because they are not className= attributes.
 *
 * Strategy: extract every "..." / '...' / `...` literal, strip ${...}
 * placeholders, split on broad whitespace + punctuation, and retain only
 * tokens that match an exact class name from dashboard.css. Filtering against
 * the dashboard class set is what keeps this from producing massive false
 * positives.
 */
function extractStringLiteralTokens(content, dashboardClassSet) {
  const stripped = stripTsComments(content);
  const tokens = new Set();

  const literals = [];
  for (const m of stripped.matchAll(/"([^"\n]+)"/g)) literals.push(m[1]);
  for (const m of stripped.matchAll(/'([^'\n]+)'/g)) literals.push(m[1]);
  for (const m of stripped.matchAll(/`([^`]+)`/g)) literals.push(m[1]);

  for (let raw of literals) {
    if (raw.includes('${')) raw = raw.replace(/\$\{[^}]*\}/g, ' ');
    for (const token of raw.split(/[\s,;:|/<>()\[\]{}!=?+*&^%$#@~"'\\]+/)) {
      const t = token.trim();
      if (!t) continue;
      // Filter 1: must exist in dashboard class set (dramatic noise reduction).
      if (!dashboardClassSet.has(t)) continue;
      // Filter 2: skip single-word tokens (no hyphen). Generic words like
      // "active", "expanded", "loading", "open", "small", "confirmed" appear
      // in countless string literals (variable names, debug messages, JSDoc
      // tags) that have nothing to do with className composition. Phase A
      // already captures these via `className` attributes; Phase B's job is
      // helper-returned compound names like "provider-tab-dot tracking-active".
      // Without this filter Phase B promotes generic modifier classes into
      // false-positive cross-folder shared bucket.
      if (!t.includes('-')) continue;
      tokens.add(t);
    }
  }
  return [...tokens];
}

async function* walkSrc(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '__tests__' ||
        entry.name.startsWith('.')
      ) {
        continue;
      }
      yield* walkSrc(full);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (
        (lower.endsWith('.tsx') || lower.endsWith('.ts')) &&
        !lower.endsWith('.spec.tsx') &&
        !lower.endsWith('.spec.ts') &&
        !lower.endsWith('.test.tsx') &&
        !lower.endsWith('.test.ts') &&
        !lower.endsWith('.d.ts')
      ) {
        yield full;
      }
    }
  }
}

async function buildClassUsage(srcRoot, dashboardClassSet) {
  const usage = new Map(); // className -> Set<relative file path>
  let phaseAHits = 0;
  let phaseBHits = 0;

  for await (const file of walkSrc(srcRoot)) {
    const content = await readFile(file, 'utf8');
    const rel = relative(ROOT, file);

    // Phase A: className-specific
    const phaseA = extractClassTokens(content);
    for (const t of phaseA) {
      if (!usage.has(t)) usage.set(t, new Set());
      const before = usage.get(t).size;
      usage.get(t).add(rel);
      if (usage.get(t).size > before) phaseAHits++;
    }

    // Phase B: broad string-literal scan, filtered against dashboard class set
    const phaseB = extractStringLiteralTokens(content, dashboardClassSet);
    for (const t of phaseB) {
      if (!usage.has(t)) usage.set(t, new Set());
      const before = usage.get(t).size;
      usage.get(t).add(rel);
      if (usage.get(t).size > before) phaseBHits++;
    }
  }
  return { usage, phaseAHits, phaseBHits };
}

async function loadOverrides() {
  try {
    const raw = await readFile(OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.manualConsumers || {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Malformed override file ${OVERRIDES_PATH}: ${err.message}`);
  }
}

// ---------- Tier classification ----------

function consumerFolderKey(relPath) {
  const m = relPath.match(/^src\/components\/([^/]+)(?:\/([^/]+))?\//);
  if (m) {
    if (m[1] === 'dashboard' && m[2] === 'prompt-detail') return 'dashboard/prompt-detail';
    return m[1];
  }
  if (/^src\/components\//.test(relPath)) return 'components-root';
  if (/^src\//.test(relPath)) return 'src-root';
  return 'other';
}

function classifyTier(consumers) {
  if (consumers.length === 0) return 'orphan';
  const folders = new Set(consumers.map(consumerFolderKey));
  if (consumers.length === 1) return 'single-owner';
  if (folders.size === 1) return 'cluster';
  return 'shared';
}

/**
 * Sub-classify orphan classes (NEW in v3).
 * Returns one of: 'true-orphan-candidate', 'compound-modifier-unresolved',
 * 'dynamic-pattern-unresolved'.
 *
 * Only `true-orphan-candidate` should be eligible for the U50 marker. The
 * other two require manual verification before any deletion attempt.
 */
function classifyOrphan(className) {
  // BEM modifier (double dash) — almost always produced via `${base}--${variant}`
  if (className.includes('--')) return 'dynamic-pattern-unresolved';

  // Single-word, no hyphen — typically a compound modifier composed at runtime
  // like className={`${base} ${state}`} (state being "active", "open", etc.)
  if (!className.includes('-')) return 'compound-modifier-unresolved';

  // The class itself ends with `-<modifier>` or starts with `<modifier>-` AND
  // its base half exists as another class — strong signal of compound modifier.
  // Without checking against the dashboard set we use a softer heuristic:
  //   any class whose final or first hyphen-separated segment is in
  //   MODIFIER_WORDS (declared at module scope so it is greppable).
  const parts = className.split('-');
  const lastSegment = parts[parts.length - 1];
  const firstSegment = parts[0];
  if (MODIFIER_WORDS.has(lastSegment) || MODIFIER_WORDS.has(firstSegment)) {
    return 'compound-modifier-unresolved';
  }

  return 'true-orphan-candidate';
}

// ---------- Output writers ----------

function tableRow(cells) {
  return '| ' + cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ') + ' |';
}

async function writeJson(path, obj) {
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function ensureExists(path) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Required input not found: ${path}`);
  }
}

// ---------- Main ----------

async function main() {
  // Capture timestamp once per run so every output file shows the same
  // `Generated: ...` line. Without this, six calls to `GENERATED_AT`
  // produce six slightly-different strings and committed-inventory diffs become
  // noisier than the actual class-mapping changes.
  const GENERATED_AT = new Date().toISOString();

  for (const f of [DASHBOARD_CSS, NOTIFICATION_CSS, APP_CSS, TOKEN_TREEMAP_CSS]) {
    await ensureExists(f);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const dashboardCss = await readFile(DASHBOARD_CSS, 'utf8');
  const notificationCss = await readFile(NOTIFICATION_CSS, 'utf8');
  const appCss = await readFile(APP_CSS, 'utf8');
  const tokenTreemapCss = await readFile(TOKEN_TREEMAP_CSS, 'utf8');

  const dashboardSelectors = extractSelectors(dashboardCss);
  const notificationSelectors = extractSelectors(notificationCss);
  const appSelectors = extractSelectors(appCss);
  const tokenTreemapSelectors = extractSelectors(tokenTreemapCss);

  // Build first-definition map for dashboard.css and the dashboard class set
  // (the set is required by Phase B before usage scan).
  const dashboardClassMap = new Map();
  for (const sel of dashboardSelectors) {
    for (const cls of sel.classes) {
      if (!dashboardClassMap.has(cls)) {
        dashboardClassMap.set(cls, {
          firstLine: sel.line,
          firstSelector: sel.raw,
          allLines: [sel.line],
        });
      } else {
        dashboardClassMap.get(cls).allLines.push(sel.line);
      }
    }
  }
  const dashboardClassSet = new Set(dashboardClassMap.keys());

  const overrides = await loadOverrides();
  const { usage, phaseAHits, phaseBHits } = await buildClassUsage(
    SRC_DIR,
    dashboardClassSet,
  );

  // Phase C: merge manual overrides
  let phaseCHits = 0;
  for (const [cls, files] of Object.entries(overrides)) {
    if (!Array.isArray(files)) continue;
    if (!usage.has(cls)) usage.set(cls, new Set());
    for (const f of files) {
      const before = usage.get(cls).size;
      usage.get(cls).add(f);
      if (usage.get(cls).size > before) phaseCHits++;
    }
  }

  const inventory = [...dashboardClassMap.entries()]
    .map(([cls, def]) => {
      const consumers = usage.has(cls) ? [...usage.get(cls)].sort() : [];
      const folders = [...new Set(consumers.map(consumerFolderKey))].sort();
      const tier = classifyTier(consumers);
      const orphanClass = tier === 'orphan' ? classifyOrphan(cls) : null;
      return {
        class: cls,
        firstLine: def.firstLine,
        firstSelector: def.firstSelector,
        definitionCount: def.allLines.length,
        consumers,
        consumerCount: consumers.length,
        folders,
        tier,
        orphanClass,
      };
    })
    .sort((a, b) => a.firstLine - b.firstLine);

  const buckets = { 'single-owner': [], cluster: [], shared: [], orphan: [] };
  for (const item of inventory) buckets[item.tier].push(item);

  const orphanBuckets = {
    'true-orphan-candidate': [],
    'compound-modifier-unresolved': [],
    'dynamic-pattern-unresolved': [],
  };
  for (const item of buckets.orphan) orphanBuckets[item.orphanClass].push(item);

  // ---- 1. selectors-ordered.txt: cascade-order baseline ----
  const orderedLines = dashboardSelectors
    .map((s) => `${String(s.line).padStart(5, ' ')}\t${s.raw}`)
    .join('\n');
  await writeFile(
    join(OUT_DIR, 'selectors-ordered.txt'),
    `# dashboard.css selectors in declaration order\n# Generated: ${GENERATED_AT}\n# Total entries (including @-rules): ${dashboardSelectors.length}\n# Format: <line>\\t<selector>\n#\n# Use this as the cascade-order baseline. After moves, the relative order of\n# the moved selectors must be preserved in the final emitted Vite CSS bundle.\n# Cross-check with scripts/css-decomp-cascade-check.mjs against dist/.\n\n${orderedLines}\n`,
    'utf8',
  );

  // ---- 2. class-consumers.json ----
  await writeJson(join(OUT_DIR, 'class-consumers.json'), {
    generated: GENERATED_AT,
    source: 'src/components/dashboard/dashboard.css',
    sharedTargetDir: 'src/components/dashboard/_shared/',
    totalClasses: inventory.length,
    counts: {
      'single-owner': buckets['single-owner'].length,
      cluster: buckets.cluster.length,
      shared: buckets.shared.length,
      orphan: buckets.orphan.length,
      'orphan:true-orphan-candidate':
        orphanBuckets['true-orphan-candidate'].length,
      'orphan:compound-modifier-unresolved':
        orphanBuckets['compound-modifier-unresolved'].length,
      'orphan:dynamic-pattern-unresolved':
        orphanBuckets['dynamic-pattern-unresolved'].length,
    },
    phaseHits: { phaseA: phaseAHits, phaseB: phaseBHits, phaseC: phaseCHits },
    classes: inventory,
  });

  // ---- 3. class-consumers.md ----
  const lines = [];
  lines.push('# Dashboard CSS Class → Consumer Inventory');
  lines.push('');
  lines.push(`- Generated: ${GENERATED_AT}`);
  lines.push('- Source: `src/components/dashboard/dashboard.css`');
  lines.push('- Shared target: `src/components/dashboard/_shared/`');
  lines.push(`- Total classes defined: **${inventory.length}**`);
  lines.push(
    `- Phase hits — A (className): ${phaseAHits}, B (string-literal scan): ${phaseBHits}, C (manual override): ${phaseCHits}`,
  );
  lines.push('');
  lines.push('## Tier distribution');
  lines.push('');
  lines.push(tableRow(['Tier', 'Count']));
  lines.push(tableRow(['---', '---']));
  for (const tier of ['single-owner', 'cluster', 'shared', 'orphan']) {
    lines.push(tableRow([tier, buckets[tier].length]));
  }
  lines.push('');
  lines.push('Orphan sub-classification:');
  lines.push('');
  lines.push(tableRow(['Sub-class', 'Count']));
  lines.push(tableRow(['---', '---']));
  for (const sub of [
    'true-orphan-candidate',
    'compound-modifier-unresolved',
    'dynamic-pattern-unresolved',
  ]) {
    lines.push(tableRow([sub, orphanBuckets[sub].length]));
  }
  lines.push('');

  function dumpBucket(title, items, withFolders) {
    lines.push(`## ${title}`);
    lines.push('');
    if (items.length === 0) {
      lines.push('_None._');
      lines.push('');
      return;
    }
    if (withFolders) {
      lines.push(tableRow(['Class', 'First Line', 'Folders', 'Consumers']));
      lines.push(tableRow(['---', '---', '---', '---']));
    } else {
      lines.push(tableRow(['Class', 'First Line', 'Consumer']));
      lines.push(tableRow(['---', '---', '---']));
    }
    for (const item of items) {
      const consumerCell =
        item.consumers.map((c) => `\`${c}\``).join('<br>') || '_(none)_';
      if (withFolders) {
        lines.push(
          tableRow([
            `\`.${item.class}\``,
            item.firstLine,
            item.folders.map((f) => `\`${f}\``).join('<br>'),
            consumerCell,
          ]),
        );
      } else {
        lines.push(tableRow([`\`.${item.class}\``, item.firstLine, consumerCell]));
      }
    }
    lines.push('');
  }

  dumpBucket('Single-owner classes (Tier 1 candidates)', buckets['single-owner'], false);
  dumpBucket('Cluster classes (Tier 2 candidates)', buckets.cluster, true);
  dumpBucket('Shared classes (Tier 3 candidates)', buckets.shared, true);

  await writeFile(join(OUT_DIR, 'class-consumers.md'), lines.join('\n'), 'utf8');

  // ---- 4. prefix-summary.md ----
  const prefixMap = new Map();
  for (const item of inventory) {
    const prefix = item.class.split('-')[0];
    if (!prefixMap.has(prefix)) {
      prefixMap.set(prefix, { classes: [], folders: new Set(), consumers: new Set() });
    }
    const bucket = prefixMap.get(prefix);
    bucket.classes.push(item.class);
    for (const f of item.folders) bucket.folders.add(f);
    for (const c of item.consumers) bucket.consumers.add(c);
  }
  const prefixRows = [...prefixMap.entries()]
    .map(([prefix, b]) => ({
      prefix,
      classCount: b.classes.length,
      folderCount: b.folders.size,
      folders: [...b.folders].sort(),
      consumers: [...b.consumers].sort(),
    }))
    .sort((a, b) => b.classCount - a.classCount);

  const prefixLines = [];
  prefixLines.push('# Dashboard CSS Prefix Summary');
  prefixLines.push('');
  prefixLines.push(`- Generated: ${GENERATED_AT}`);
  prefixLines.push(`- Distinct prefixes: ${prefixRows.length}`);
  prefixLines.push('- Shared target: `src/components/dashboard/_shared/`');
  prefixLines.push('');
  prefixLines.push('Folder count tells you the migration tier at a glance:');
  prefixLines.push('');
  prefixLines.push('- **0 folders**: every class in this prefix is orphan (no static consumer).');
  prefixLines.push('- **1 folder**: cluster — single-folder ownership; safe Tier 1/2 move.');
  prefixLines.push(
    '- **≥2 folders**: shared — Tier 3 move into `src/components/dashboard/_shared/`.',
  );
  prefixLines.push('');
  prefixLines.push(tableRow(['Prefix', 'Class Count', 'Folder Count', 'Folders', 'Consumers']));
  prefixLines.push(tableRow(['---', '---', '---', '---', '---']));
  for (const r of prefixRows) {
    prefixLines.push(
      tableRow([
        `\`${r.prefix}-*\``,
        r.classCount,
        r.folderCount,
        r.folders.length === 0 ? '_(orphan)_' : r.folders.map((f) => `\`${f}\``).join('<br>'),
        r.consumers.length === 0
          ? '_(none)_'
          : r.consumers.map((c) => `\`${c}\``).join('<br>'),
      ]),
    );
  }
  await writeFile(join(OUT_DIR, 'prefix-summary.md'), prefixLines.join('\n') + '\n', 'utf8');

  // ---- 5. collisions.md ----
  const dashboardClassSet2 = new Set(inventory.map((i) => i.class));
  const notificationClassSet = new Set();
  for (const sel of notificationSelectors) {
    for (const c of sel.classes) notificationClassSet.add(c);
  }
  const appClassSet = new Set();
  for (const sel of appSelectors) for (const c of sel.classes) appClassSet.add(c);
  const tokenTreemapClassSet = new Set();
  for (const sel of tokenTreemapSelectors) {
    for (const c of sel.classes) tokenTreemapClassSet.add(c);
  }

  const dashVsNotif = [...dashboardClassSet2].filter((c) => notificationClassSet.has(c)).sort();
  const dashVsApp = [...dashboardClassSet2].filter((c) => appClassSet.has(c)).sort();
  const dashVsTokenTreemap = [...dashboardClassSet2]
    .filter((c) => tokenTreemapClassSet.has(c))
    .sort();

  const collisionLines = [];
  collisionLines.push('# Cross-file Class Collisions');
  collisionLines.push('');
  collisionLines.push(
    'Classes defined in `dashboard.css` AND in another stylesheet. Before P1 reconciliation, prove whether the colliding stylesheets ship in the same Vite bundle and whether any DOM node can match both rule families. Rename or delete only after that proof (per Codex v2 review non-blocking #1).',
  );
  collisionLines.push('');
  collisionLines.push(`- Generated: ${GENERATED_AT}`);
  collisionLines.push('');
  collisionLines.push('## dashboard.css vs notification.css');
  collisionLines.push('');
  collisionLines.push(`Found: **${dashVsNotif.length}**`);
  collisionLines.push('');
  if (dashVsNotif.length > 0) {
    for (const c of dashVsNotif) collisionLines.push(`- \`.${c}\``);
  } else {
    collisionLines.push('_None._');
  }
  collisionLines.push('');
  collisionLines.push('## dashboard.css vs App.css');
  collisionLines.push('');
  collisionLines.push(`Found: **${dashVsApp.length}**`);
  collisionLines.push('');
  if (dashVsApp.length > 0) for (const c of dashVsApp) collisionLines.push(`- \`.${c}\``);
  else collisionLines.push('_None._');
  collisionLines.push('');
  collisionLines.push('## dashboard.css vs TokenTreemap.css');
  collisionLines.push('');
  collisionLines.push(`Found: **${dashVsTokenTreemap.length}**`);
  collisionLines.push('');
  if (dashVsTokenTreemap.length > 0)
    for (const c of dashVsTokenTreemap) collisionLines.push(`- \`.${c}\``);
  else collisionLines.push('_None._');
  collisionLines.push('');

  await writeFile(join(OUT_DIR, 'collisions.md'), collisionLines.join('\n') + '\n', 'utf8');

  // ---- 6. orphans.md (3-way classification) ----
  const orphanLines = [];
  orphanLines.push('# Orphan Classes in dashboard.css (3-way classification)');
  orphanLines.push('');
  orphanLines.push(
    'Classes defined in `src/components/dashboard/dashboard.css` with **zero static consumers** found in `src/**/*.{ts,tsx}` after Phase A (className-specific extraction), Phase B (broad string-literal scan filtered against the dashboard class set), and Phase C (manual overrides from `scripts/css-decomp-overrides.json`).',
  );
  orphanLines.push('');
  orphanLines.push(
    '**Per Codex v2 review blocking #2: only `true-orphan-candidate` is eligible for the U50 `/* UNUSED candidate */` marker.** The other two buckets require manual verification before any deletion attempt because their static analysis is known to be incomplete.',
  );
  orphanLines.push('');
  orphanLines.push(`- Generated: ${GENERATED_AT}`);
  orphanLines.push(`- Total orphans: **${buckets.orphan.length}**`);
  orphanLines.push('');

  function dumpOrphanBucket(title, sub, items, advice) {
    orphanLines.push(`## ${title}`);
    orphanLines.push('');
    orphanLines.push(advice);
    orphanLines.push('');
    orphanLines.push(`Count: **${items.length}**`);
    orphanLines.push('');
    if (items.length === 0) {
      orphanLines.push('_None._');
      orphanLines.push('');
      return;
    }
    orphanLines.push(tableRow(['Class', 'First Line', 'First Selector']));
    orphanLines.push(tableRow(['---', '---', '---']));
    for (const item of items) {
      orphanLines.push(
        tableRow([
          `\`.${item.class}\``,
          item.firstLine,
          `\`${item.firstSelector}\``,
        ]),
      );
    }
    orphanLines.push('');
  }

  dumpOrphanBucket(
    'true-orphan-candidate',
    'true-orphan-candidate',
    orphanBuckets['true-orphan-candidate'],
    'No plausible runtime usage detected. **Eligible for U50 `/* UNUSED candidate */` marker.** Verify each entry once more via `grep -rn` for the literal class name across the repo before the follow-up cleanup epic deletes it.',
  );
  dumpOrphanBucket(
    'compound-modifier-unresolved',
    'compound-modifier-unresolved',
    orphanBuckets['compound-modifier-unresolved'],
    'Class name looks like a compound modifier (single English word, or ends/starts with a known modifier suffix). **Likely composed at runtime via `className={`${base} ${modifier}`}`** but the static scan could not link it to its base. Do NOT mark with U50 — verify each entry by reading the consuming component.',
  );
  dumpOrphanBucket(
    'dynamic-pattern-unresolved',
    'dynamic-pattern-unresolved',
    orphanBuckets['dynamic-pattern-unresolved'],
    'BEM-style modifier (`--variant`) or other dynamic-pattern class. **Likely produced via template literal `prefix-${variant}`.** Add an entry to `scripts/css-decomp-overrides.json` mapping each runtime variant to its consumer file, then re-run the inventory.',
  );

  await writeFile(join(OUT_DIR, 'orphans.md'), orphanLines.join('\n'), 'utf8');

  // ---- Console summary ----
  console.log('-- css-decomp-inventory v3 --');
  console.log(`Dashboard classes defined: ${inventory.length}`);
  console.log(`  single-owner: ${buckets['single-owner'].length}`);
  console.log(`  cluster:      ${buckets.cluster.length}`);
  console.log(`  shared:       ${buckets.shared.length}`);
  console.log(`  orphan:       ${buckets.orphan.length}`);
  console.log(
    `    true-orphan-candidate:        ${orphanBuckets['true-orphan-candidate'].length}`,
  );
  console.log(
    `    compound-modifier-unresolved: ${orphanBuckets['compound-modifier-unresolved'].length}`,
  );
  console.log(
    `    dynamic-pattern-unresolved:   ${orphanBuckets['dynamic-pattern-unresolved'].length}`,
  );
  console.log(
    `Phase hits  A: ${phaseAHits}  B: ${phaseBHits}  C: ${phaseCHits}`,
  );
  console.log(
    `Cross-file collisions  notification: ${dashVsNotif.length}  App: ${dashVsApp.length}  TokenTreemap: ${dashVsTokenTreemap.length}`,
  );
  console.log(`Distinct prefixes: ${prefixRows.length}`);
  console.log(`Selector-order baseline entries: ${dashboardSelectors.length}`);
  console.log(`Output: ${relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
