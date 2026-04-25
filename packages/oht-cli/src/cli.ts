// @ohmytoken/oht-cli entry logic — kept runtime-import-free so vitest can
// execute it without installing workspace bins. bin.ts is the executable
// shell that invokes runCli() with process.argv.

import { runStatusline } from "./statusline.js";

export const CLI_VERSION = "0.0.1";

const DEFAULT_EVENT_BUS_PORT = 8781;
const STATUSLINE_TIMEOUT_MS = 800;

export interface WritableLike {
  write(chunk: string): boolean | void;
}

export interface CliOptions {
  port?: number;
  timeoutMs?: number;
}

export async function runCli(
  args: readonly string[],
  out: WritableLike,
  options: CliOptions = {},
): Promise<number> {
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
    return runStatusline({
      out,
      port: options.port ?? readPortFromEnv() ?? DEFAULT_EVENT_BUS_PORT,
      timeoutMs: options.timeoutMs ?? STATUSLINE_TIMEOUT_MS,
    });
  }

  out.write(
    `oht: unknown command "${command}". Try "oht --help" for the list of supported commands.\n`,
  );
  return 2;
}

function readPortFromEnv(): number | null {
  const raw = process.env.OHT_EVENT_BUS_PORT;
  if (!raw) return null;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : null;
}

function writeHelp(out: WritableLike): void {
  const lines = [
    "oht — OhMyToken terminal HUD CLI",
    "",
    "Usage:",
    "  oht --version          Print CLI version",
    "  oht --help             Print this help",
    "  oht tui                Sidecar TUI (Phase 2, coming soon)",
    "  oht statusline         Claude Code statusLine reader (P6-mini)",
    "",
    "Environment:",
    "  OHT_EVENT_BUS_PORT     Override the event-bus port (default: 8781).",
    "",
  ];
  out.write(lines.join("\n"));
}
