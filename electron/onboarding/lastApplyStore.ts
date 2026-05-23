import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApplyResult } from './ruleAckInsert';

const FILE_NAME = 'rule-ack-last-apply.json';

const resolvePath = (userDataDir: string): string =>
  path.join(userDataDir, FILE_NAME);

export const readLastApply = async (
  userDataDir: string,
): Promise<ApplyResult | null> => {
  try {
    const raw = await fs.readFile(resolvePath(userDataDir), 'utf8');
    const parsed: ApplyResult = JSON.parse(raw);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
};

export const writeLastApply = async (
  userDataDir: string,
  result: ApplyResult,
): Promise<void> => {
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(
    resolvePath(userDataDir),
    JSON.stringify(result, null, 2),
    'utf8',
  );
};

export const clearLastApply = async (userDataDir: string): Promise<void> => {
  await fs.unlink(resolvePath(userDataDir)).catch(() => {});
};
