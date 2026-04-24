// @ohmytoken/oht-cli entry logic — kept runtime-import-free so vitest can
// execute it without installing workspace bins. bin.ts is the executable
// shell that invokes runCli() with process.argv.

export const CLI_VERSION = "0.0.1";

export interface WritableLike {
  write(chunk: string): boolean | void;
}

export function runCli(args: readonly string[], out: WritableLike): number {
  const [command, ...rest] = args;

  if (command === "--version" || command === "-v") {
    out.write(`oht ${CLI_VERSION}\n`);
    return 0;
  }

  if (command === undefined || command === "--help" || command === "-h") {
    writeHelp(out);
    return 0;
  }

  if (command === "tui") {
    void rest;
    out.write(
      "oht tui: not yet implemented — lands in Phase 2 of the terminal HUD epic (#301).\n",
    );
    return 3;
  }

  if (command === "statusline") {
    out.write(
      "oht statusline: not yet implemented — lands in Phase 6 of the terminal HUD epic (#301).\n",
    );
    return 3;
  }

  out.write(
    `oht: unknown command "${command}". Try "oht --help" for the list of supported commands.\n`,
  );
  return 2;
}

function writeHelp(out: WritableLike): void {
  const lines = [
    "oht — OhMyToken terminal HUD CLI",
    "",
    "Usage:",
    "  oht --version          Print CLI version",
    "  oht --help             Print this help",
    "  oht tui                Sidecar TUI (Phase 2, coming soon)",
    "  oht statusline         Claude Code statusLine formatter (Phase 6)",
    "",
  ];
  out.write(lines.join("\n"));
}
