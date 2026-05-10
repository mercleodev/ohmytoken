type StopHookCommand = { type?: string; command?: string };
type StopMatcherBlock = { matcher?: string; hooks?: StopHookCommand[] };
type Settings = Record<string, unknown> & {
  hooks?: { Stop?: StopMatcherBlock[] } & Record<string, unknown>;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const flattenStopCommands = (settings: Settings): StopHookCommand[] => {
  const stop = settings.hooks?.Stop;
  if (!Array.isArray(stop)) return [];
  return stop.flatMap((block) =>
    Array.isArray(block?.hooks) ? (block.hooks as StopHookCommand[]) : [],
  );
};

export const isHookInstalled = (settings: Settings, command: string): boolean =>
  flattenStopCommands(settings).some((h) => h.command === command);

export const installStopHook = (settings: Settings, command: string): Settings => {
  if (isHookInstalled(settings, command)) return cloneJson(settings);

  const next = cloneJson(settings);
  if (!next.hooks || typeof next.hooks !== "object") {
    next.hooks = {};
  }
  const hooksObj = next.hooks as { Stop?: StopMatcherBlock[] } & Record<string, unknown>;
  const stopArr: StopMatcherBlock[] = Array.isArray(hooksObj.Stop) ? hooksObj.Stop : [];

  stopArr.push({
    matcher: "*",
    hooks: [{ type: "command", command }],
  });
  hooksObj.Stop = stopArr;
  return next;
};

export const uninstallStopHook = (settings: Settings, command: string): Settings => {
  if (!isHookInstalled(settings, command)) return cloneJson(settings);

  const next = cloneJson(settings);
  const hooksObj = next.hooks as { Stop?: StopMatcherBlock[] } | undefined;
  if (!hooksObj || !Array.isArray(hooksObj.Stop)) return next;

  const filtered: StopMatcherBlock[] = [];
  for (const block of hooksObj.Stop) {
    if (!block || !Array.isArray(block.hooks)) {
      filtered.push(block);
      continue;
    }
    const remaining = block.hooks.filter((h) => h.command !== command);
    if (remaining.length === 0) continue;
    filtered.push({ ...block, hooks: remaining });
  }

  if (filtered.length === 0) {
    delete hooksObj.Stop;
  } else {
    hooksObj.Stop = filtered;
  }
  return next;
};
