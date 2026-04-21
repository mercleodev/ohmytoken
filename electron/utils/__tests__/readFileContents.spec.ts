import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { homedir } from 'os';

vi.mock('fs');

import * as fs from 'fs';
import { readFileContentsFromDisk, isSensitivePath } from '../readFileContents';

const home = homedir();

describe('isSensitivePath', () => {
  it('blocks ~/.claude/config.json', () => {
    expect(isSensitivePath(path.join(home, '.claude', 'config.json'))).toBe(true);
  });

  it('blocks ~/.netrc', () => {
    expect(isSensitivePath(path.join(home, '.netrc'))).toBe(true);
  });

  it('blocks ~/.ssh/id_rsa', () => {
    expect(isSensitivePath(path.join(home, '.ssh', 'id_rsa'))).toBe(true);
  });

  it('blocks ~/.ssh/id_ed25519', () => {
    expect(isSensitivePath(path.join(home, '.ssh', 'id_ed25519'))).toBe(true);
  });

  it('blocks .env files', () => {
    expect(isSensitivePath('/project/.env')).toBe(true);
    expect(isSensitivePath('/project/.env.local')).toBe(true);
    expect(isSensitivePath('/project/.env.production')).toBe(true);
  });

  it('blocks .pem and .key files', () => {
    expect(isSensitivePath('/certs/server.pem')).toBe(true);
    expect(isSensitivePath('/certs/private.key')).toBe(true);
  });

  it('blocks ~/.aws/credentials', () => {
    expect(isSensitivePath(path.join(home, '.aws', 'credentials'))).toBe(true);
  });

  it('blocks ~/.config/gh/hosts.yml', () => {
    expect(isSensitivePath(path.join(home, '.config', 'gh', 'hosts.yml'))).toBe(true);
  });

  it('does not block regular project files', () => {
    expect(isSensitivePath('/project/CLAUDE.md')).toBe(false);
    expect(isSensitivePath('/project/.claude/rules/style.md')).toBe(false);
    expect(isSensitivePath(path.join(home, '.claude', 'CLAUDE.md'))).toBe(false);
  });
});

describe('readFileContentsFromDisk', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('file content');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads safe paths', () => {
    const result = readFileContentsFromDisk(['/project/CLAUDE.md']);
    expect(result['/project/CLAUDE.md']).toBe('file content');
  });

  it('silently skips sensitive paths without reading', () => {
    const blocked = path.join(home, '.claude', 'config.json');
    const result = readFileContentsFromDisk([blocked]);
    expect(result[blocked]).toBeUndefined();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('skips sensitive paths even when mixed with safe paths', () => {
    const safe = '/project/CLAUDE.md';
    const blocked = path.join(home, '.netrc');
    const result = readFileContentsFromDisk([safe, blocked]);
    expect(result[safe]).toBe('file content');
    expect(result[blocked]).toBeUndefined();
  });

  it('skips non-existent files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = readFileContentsFromDisk(['/project/missing.md']);
    expect(result['/project/missing.md']).toBeUndefined();
  });
});
