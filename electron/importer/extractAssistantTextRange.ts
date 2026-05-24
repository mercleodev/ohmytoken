/**
 * Issue #378 — collect assistant `text` blocks across every assistant entry
 * inside a single user-prompt turn.
 *
 * The previous history-import path used a single `usage`-bearing entry to
 * source `assistant_response`. When that entry was `thinking`-only the
 * stored response was empty, draining text-overlap and instruction-
 * compliance evidence signals. This helper restores parity with what a
 * reader sees in the transcript: the concatenation of every visible
 * assistant text block in the turn.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type RangeEntry = {
  type: string;
  message?: {
    content?: unknown;
  };
};

export const extractAssistantTextRange = (
  entries: readonly RangeEntry[],
  startIdx: number,
  endIdx: number,
): string => {
  const parts: string[] = [];
  const upper = Math.min(endIdx, entries.length);

  for (let i = Math.max(0, startIdx); i < upper; i++) {
    const entry = entries[i];
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!content) continue;

    if (typeof content === "string") {
      if (content.length > 0) parts.push(content);
      continue;
    }

    if (Array.isArray(content)) {
      const text = content
        .filter(
          (b: any) => b?.type === "text" && typeof b.text === "string",
        )
        .map((b: any) => b.text as string)
        .join("\n");
      if (text.length > 0) parts.push(text);
    }
  }

  return parts.join("\n").trim();
};
