import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readLastApply,
  writeLastApply,
  clearLastApply,
} from '../lastApplyStore';
import type { ApplyResult } from '../ruleAckInsert';

describe('lastApplyStore', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omt-last-apply-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when no last-apply file exists', async () => {
    expect(await readLastApply(tmp)).toBeNull();
  });

  it('round-trips an ApplyResult through write+read', async () => {
    const result: ApplyResult = {
      ok: true,
      applied: [
        {
          filePath: '/x/tailwind.md',
          backupPath: '/x/tailwind.md.bak',
          proposedId: 'tailwind',
        },
      ],
      skipped: [],
      failedAt: null,
    };
    await writeLastApply(tmp, result);
    expect(await readLastApply(tmp)).toEqual(result);
  });

  it('clearLastApply removes the file', async () => {
    await writeLastApply(tmp, {
      ok: true, applied: [], skipped: [], failedAt: null,
    });
    await clearLastApply(tmp);
    expect(await readLastApply(tmp)).toBeNull();
  });
});
