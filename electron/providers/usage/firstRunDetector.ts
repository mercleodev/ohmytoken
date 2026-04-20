import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

export type FirstRunStatus = {
  isFirstRun: boolean;
  sessionRootsPresent: boolean;
  totalPromptCount: number;
};

type Deps = {
  sessionRootPaths?: string[];
  getTotalPromptCount: () => number;
  existsSync?: (p: string) => boolean;
  hasAnyEntries?: (p: string) => boolean;
};

const defaultSessionRoots = (): string[] => [
  path.join(homedir(), ".claude", "projects"),
  path.join(homedir(), ".codex", "sessions"),
];

const defaultHasAnyEntries = (dir: string): boolean => {
  try {
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
};

export const computeFirstRunStatus = (deps: Deps): FirstRunStatus => {
  const roots = deps.sessionRootPaths ?? defaultSessionRoots();
  const exists = deps.existsSync ?? fs.existsSync;
  const hasEntries = deps.hasAnyEntries ?? defaultHasAnyEntries;

  const sessionRootsPresent = roots.some(
    (root) => exists(root) && hasEntries(root),
  );

  let totalPromptCount = 0;
  try {
    totalPromptCount = deps.getTotalPromptCount();
  } catch {
    totalPromptCount = 0;
  }

  const isFirstRun = !sessionRootsPresent && totalPromptCount === 0;
  return { isFirstRun, sessionRootsPresent, totalPromptCount };
};
