/**
 * Parser Dispatcher
 *
 * Routes session files to the appropriate parser based on client type.
 * Currently only Claude is supported; Codex/Gemini can be added later.
 */
import { parseClaudeSessionFile } from "./claude";
import type { BackfillMessage } from "../types";

export const parseSessionFile = (
  filePath: string,
  sessionId: string,
  projectDir: string,
  client: "claude" = "claude",
): BackfillMessage[] => {
  switch (client) {
    case "claude":
      return parseClaudeSessionFile(filePath, sessionId, projectDir);
    default:
      return [];
  }
};
