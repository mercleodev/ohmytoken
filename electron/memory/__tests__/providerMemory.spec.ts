import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveMemoryDir,
  getMemoryStatusForProvider,
  memoryLabelForProvider,
} from '../providerMemory';

describe('providerMemory', () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ohmytoken-mem-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('resolveMemoryDir', () => {
    it('returns Claude project memory dir for claude provider', () => {
      const projectPath = '/tmp/fake-proj-ohmytoken';
      const encoded = projectPath.replace(/\//g, '-');
      const expected = path.join(tmpHome, '.claude', 'projects', encoded, 'memory');
      expect(resolveMemoryDir('claude', projectPath)).toBe(expected);
    });

    it('returns Codex memories dir for codex provider (global)', () => {
      const projectPath = '/tmp/fake-proj-ohmytoken';
      const expected = path.join(tmpHome, '.codex', 'memories');
      expect(resolveMemoryDir('codex', projectPath)).toBe(expected);
    });

    it('defaults to claude when provider is undefined (backward compat)', () => {
      const projectPath = '/tmp/fake-proj-ohmytoken';
      const encoded = projectPath.replace(/\//g, '-');
      const expected = path.join(tmpHome, '.claude', 'projects', encoded, 'memory');
      expect(resolveMemoryDir(undefined, projectPath)).toBe(expected);
    });

    it('returns null for unsupported provider', () => {
      expect(resolveMemoryDir('gemini', '/any')).toBeNull();
    });
  });

  describe('memoryLabelForProvider', () => {
    it('returns Claude Memory for claude provider', () => {
      expect(memoryLabelForProvider('claude')).toBe('Claude Memory');
    });
    it('returns Codex Memory for codex provider', () => {
      expect(memoryLabelForProvider('codex')).toBe('Codex Memory');
    });
    it('defaults to Claude Memory when undefined', () => {
      expect(memoryLabelForProvider(undefined)).toBe('Claude Memory');
    });
  });

  describe('getMemoryStatusForProvider', () => {
    it('reads Codex memories dir and parses markdown files', () => {
      const codexDir = path.join(tmpHome, '.codex', 'memories');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'note.md'),
        '---\nname: Codex Note\ndescription: sample codex memory\ntype: project\n---\nbody line\n',
      );

      const status = getMemoryStatusForProvider({ provider: 'codex', projectPath: '/any' });
      expect(status).not.toBeNull();
      expect(status!.files).toHaveLength(1);
      expect(status!.files[0].name).toBe('Codex Note');
      expect(status!.files[0].type).toBe('project');
    });

    it('reads Claude project memory dir', () => {
      const projectPath = '/tmp/fake-proj-demo';
      const encoded = projectPath.replace(/\//g, '-');
      const claudeDir = path.join(tmpHome, '.claude', 'projects', encoded, 'memory');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, 'u.md'),
        '---\nname: User Pref\ndescription: claude memory\ntype: user\n---\ncontent\n',
      );

      const status = getMemoryStatusForProvider({ provider: 'claude', projectPath });
      expect(status).not.toBeNull();
      expect(status!.files[0].name).toBe('User Pref');
      expect(status!.files[0].type).toBe('user');
    });

    it('returns null when memory dir does not exist', () => {
      const status = getMemoryStatusForProvider({ provider: 'codex', projectPath: '/any' });
      expect(status).toBeNull();
    });

    it('returns null for unsupported provider', () => {
      const status = getMemoryStatusForProvider({ provider: 'gemini', projectPath: '/any' });
      expect(status).toBeNull();
    });
  });
});
