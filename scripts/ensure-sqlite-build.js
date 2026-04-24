#!/usr/bin/env node
/* eslint-disable */
/**
 * Ensures better-sqlite3 native module is compiled for the correct runtime.
 *
 * Usage:
 *   node scripts/ensure-sqlite-build.js electron   # before electron:dev / start
 *   node scripts/ensure-sqlite-build.js node        # before vitest / node scripts
 *
 * Reads the build config.gypi to detect current build target and only
 * rebuilds when necessary, avoiding the recurring ABI mismatch:
 *   - Node.js 22: MODULE_VERSION 127
 *   - Electron 28: MODULE_VERSION 119
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const target = process.argv[2]; // 'electron' or 'node'

if (!target || !['electron', 'node'].includes(target)) {
  console.error('[sqlite-build] Usage: node ensure-sqlite-build.js <electron|node>');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'config.gypi');
const BINARY_PATH = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

function getCurrentBuild() {
  // No binary at all → needs build
  if (!fs.existsSync(BINARY_PATH)) return 'missing';

  try {
    const config = fs.readFileSync(CONFIG_PATH, 'utf8');
    const isElectron =
      config.includes('"built_with_electron": 1') &&
      config.includes('"runtime": "electron"');
    return isElectron ? 'electron' : 'node';
  } catch {
    return 'unknown';
  }
}

const current = getCurrentBuild();

if (current === target) {
  console.log(`[sqlite-build] ✓ already compiled for ${target}`);
  process.exit(0);
}

console.log(`[sqlite-build] current=${current}, target=${target} → rebuilding...`);

try {
  if (target === 'electron') {
    // Rebuild for Electron using @electron/rebuild
    execSync('npx --yes @electron/rebuild -f -w better-sqlite3', {
      stdio: 'inherit',
      cwd: ROOT,
    });
  } else {
    // Rebuild for Node.js using prebuild-install (prebuilt) or node-gyp (source)
    const sqlite3Dir = path.join(ROOT, 'node_modules', 'better-sqlite3');
    execSync('npx --yes node-gyp rebuild --release', {
      stdio: 'inherit',
      cwd: sqlite3Dir,
    });
  }
} catch (err) {
  // @electron/rebuild can fail during cleanup even after the native module
  // was successfully rebuilt. Accept the run if post-check verification says
  // the binary now targets the requested runtime.
  const recovered = getCurrentBuild();
  if (recovered === target) {
    console.warn(
      `[sqlite-build] rebuild reported an error, but verification shows ${target} binary is ready; continuing`,
    );
  } else {
    console.error(`[sqlite-build] rebuild failed: ${err.message}`);
    process.exit(1);
  }
}

// Verify rebuild succeeded
const after = getCurrentBuild();
if (after === target) {
  console.log(`[sqlite-build] ✓ rebuild complete for ${target}`);
} else {
  console.error(`[sqlite-build] ✗ rebuild verification failed (expected=${target}, got=${after})`);
  process.exit(1);
}
