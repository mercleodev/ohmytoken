import { describe, it, expect } from "vitest";
import { extractInjectedFromMessages } from "../injectedFromMessages";

// The fixture below mirrors the shape captured live from Claude Code 2.1.119
// on 2026-05-10: a `<system-reminder>` text block in `messages[0].content[]`
// whose body opens with `# claudeMd` and embeds the standard
// `Contents of <path> (note):` headers for both global and project CLAUDE.md.
// Paths are anonymised; the parser only cares about the marker + header
// shape, not specific filesystem locations.
const GLOBAL_PATH = "/tmp/fixture-claude/global-CLAUDE.md";
const PROJECT_PATH = "/tmp/fixture-claude/sample-app/CLAUDE.md";

const claudeMdReminder = `<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of ${GLOBAL_PATH} (user's private global instructions for all projects):

# Global Preferences

- Keep responses concise.

Contents of ${PROJECT_PATH} (project instructions, checked into the codebase):

# CLAUDE.md

This is the project guide.
</system-reminder>`;

const minimalUserMessage = (text: string) => ({
  role: "user",
  content: [{ type: "text", text }],
});

describe("extractInjectedFromMessages", () => {
  it("returns no files when messages is missing or not an array", () => {
    expect(extractInjectedFromMessages(undefined)).toEqual([]);
    expect(extractInjectedFromMessages(null)).toEqual([]);
    expect(extractInjectedFromMessages("not-an-array")).toEqual([]);
    expect(extractInjectedFromMessages({ role: "user" })).toEqual([]);
  });

  it("returns no files when no message contains the `# claudeMd` marker", () => {
    const messages = [
      { role: "user", content: "starting work on the sample app" },
      minimalUserMessage("Contents of /tmp/foo.md (just text in a user prompt):\n\nhello"),
    ];
    expect(extractInjectedFromMessages(messages)).toEqual([]);
  });

  it("extracts both global and project CLAUDE.md from the first user message's `# claudeMd` block", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>some other reminder</system-reminder>" },
          { type: "text", text: claudeMdReminder },
          { type: "text", text: "say hi" },
        ],
      },
    ];

    const out = extractInjectedFromMessages(messages);
    expect(out).toHaveLength(2);

    const global = out.find((f) => f.path === GLOBAL_PATH);
    expect(global).toBeDefined();
    expect(global?.category).toBe("global");
    expect(global?.estimated_tokens).toBeGreaterThan(0);

    const project = out.find((f) => f.path === PROJECT_PATH);
    expect(project).toBeDefined();
    expect(project?.category).toBe("project");
    expect(project?.estimated_tokens).toBeGreaterThan(0);
  });

  it("ignores `Contents of` headers that appear in user-typed text outside a `# claudeMd` block — the marker gates the parse", () => {
    const messages = [
      minimalUserMessage(
        "Look at this snippet I copied:\n\nContents of /tmp/copied.md (random):\n\nhello",
      ),
    ];
    expect(extractInjectedFromMessages(messages)).toEqual([]);
  });

  it("only inspects user messages — `# claudeMd` text in an assistant message is ignored", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: claudeMdReminder }] },
    ];
    expect(extractInjectedFromMessages(messages)).toEqual([]);
  });

  it("handles a `# claudeMd` block that is not in the first message — Claude Code may move it on resume", () => {
    const messages = [
      minimalUserMessage("first turn"),
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_x", content: "result" },
        ],
      },
      minimalUserMessage(claudeMdReminder),
    ];
    expect(extractInjectedFromMessages(messages)).toHaveLength(2);
  });

  it("dedupes paths that appear in more than one user message and keeps the entry with the higher token count", () => {
    const shortReminder = `<system-reminder>
# claudeMd
Contents of ${GLOBAL_PATH} (user's private global instructions for all projects):

short
</system-reminder>`;
    const longReminder = `<system-reminder>
# claudeMd
Contents of ${GLOBAL_PATH} (user's private global instructions for all projects):

a much much much longer block of guidance that should win the dedup tie because its token count is higher
</system-reminder>`;
    const messages = [minimalUserMessage(shortReminder), minimalUserMessage(longReminder)];

    const out = extractInjectedFromMessages(messages);
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe(GLOBAL_PATH);
    // long reminder has more characters, so its estimated_tokens must be the one kept
    expect(out[0].estimated_tokens).toBeGreaterThan(2);
  });

  it("ignores non-text blocks inside a user message (tool_result, image, etc.)", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "x", content: claudeMdReminder },
          { type: "image", source: { type: "base64", data: "..." } },
        ],
      },
    ];
    expect(extractInjectedFromMessages(messages)).toEqual([]);
  });
});
