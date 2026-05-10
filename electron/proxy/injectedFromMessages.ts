import { InjectedFile } from "./types";
import { extractInjectedFilesFromText } from "./systemParser";

/**
 * Marker that gates the parse. Claude Code 2.x wraps the
 * `Contents of <path>:` headers for global + project CLAUDE.md inside a
 * `<system-reminder>` block whose body opens with `# claudeMd`. Without
 * this gate, a literal `Contents of …:` substring inside a user-typed
 * prompt would falsely add fictional rows to `injected_files`. The gate
 * is checked per text block; if a future CC release splits the reminder
 * across sibling blocks, the marker check will need to broaden to a
 * message-level scan.
 */
const CLAUDE_MD_MARKER = "# claudeMd";

type MessageBlock = { type?: string; text?: string };
type Message = { role?: string; content?: unknown };

/**
 * Walk the `messages[]` of an Anthropic `/v1/messages` request and pull
 * out CLAUDE.md / project CLAUDE.md entries that Claude Code 2.x injects
 * as a `<system-reminder># claudeMd` text block. The format of those
 * blocks reuses the same `Contents of <path> (note):` headers the proxy
 * already understood from the legacy `system` field, so the kernel is
 * shared with `parseSystemField` (see issue #341, captured 2026-05-10).
 *
 * Only `role: "user"` messages are considered, because the marker text
 * is a system reminder injected at request time and never appears in
 * assistant turns. Tool-result and image blocks are skipped so that
 * past Read tool output cannot accidentally produce injected_files
 * rows. When the same path shows up in more than one message, the
 * entry with the higher `estimated_tokens` value wins the dedup so we
 * report the most informative copy.
 */
export const extractInjectedFromMessages = (messages: unknown): InjectedFile[] => {
  if (!Array.isArray(messages)) return [];

  const merged = new Map<string, InjectedFile>();

  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Message;
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;

    for (const block of msg.content as MessageBlock[]) {
      if (!block || typeof block !== "object") continue;
      if (block.type !== "text" || typeof block.text !== "string") continue;
      if (!block.text.includes(CLAUDE_MD_MARKER)) continue;

      for (const file of extractInjectedFilesFromText(block.text)) {
        const prev = merged.get(file.path);
        if (!prev || file.estimated_tokens > prev.estimated_tokens) {
          merged.set(file.path, file);
        }
      }
    }
  }

  return [...merged.values()];
};
