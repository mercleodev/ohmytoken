import * as path from 'path';
import * as fs from 'fs';
import { homedir } from 'os';

const home = homedir();

const BLOCKED_PATHS = new Set([
  path.join(home, '.claude', 'config.json'),
  path.join(home, '.config', 'gh', 'hosts.yml'),
  path.join(home, '.netrc'),
  path.join(home, '.npmrc'),
  path.join(home, '.yarnrc'),
  path.join(home, '.yarnrc.yml'),
  path.join(home, '.aws', 'credentials'),
  path.join(home, '.aws', 'config'),
  path.join(home, '.pip', 'pip.conf'),
  path.join(home, '.pypirc'),
]);

// Any file under ~/.ssh must not be read (private keys, known_hosts, config)
const BLOCKED_DIR_PREFIXES = [
  path.join(home, '.ssh') + path.sep,
];

const BLOCKED_BASENAMES = new Set(['.env', '.htpasswd']);

const BLOCKED_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.crt'];

export function isSensitivePath(resolvedPath: string): boolean {
  if (BLOCKED_PATHS.has(resolvedPath)) return true;

  const basename = path.basename(resolvedPath);
  if (BLOCKED_BASENAMES.has(basename)) return true;
  // .env, .env.local, .env.production, etc.
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (BLOCKED_SUFFIXES.some((s) => resolvedPath.endsWith(s))) return true;
  if (BLOCKED_DIR_PREFIXES.some((d) => resolvedPath.startsWith(d))) return true;

  return false;
}

/**
 * Read injected file contents from disk (best-effort). Paths matching the
 * sensitive-path blocklist are silently skipped to prevent OAuth tokens and
 * private keys from leaking into evidence reports.
 */
export function readFileContentsFromDisk(paths: string[]): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const p of paths) {
    try {
      const resolved = path.isAbsolute(p) ? p : path.resolve(p);
      if (isSensitivePath(resolved)) continue;
      if (fs.existsSync(resolved)) {
        contents[p] = fs.readFileSync(resolved, 'utf-8');
      }
    } catch {
      // Silently skip unreadable files
    }
  }
  return contents;
}
