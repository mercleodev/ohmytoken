import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextTreemap } from "../ContextTreemap";
import type { PromptScan } from "../../../types";

const makeScan = (overrides?: Partial<PromptScan>): PromptScan => ({
  request_id: "req-001",
  session_id: "sess-001",
  timestamp: new Date().toISOString(),
  user_prompt: "Test prompt",
  user_prompt_tokens: 10,
  injected_files: [
    { path: "~/.claude/CLAUDE.md", category: "global", estimated_tokens: 3581 },
    { path: "~/prj/CLAUDE.md", category: "project", estimated_tokens: 1994 },
  ],
  total_injected_tokens: 5575,
  tool_calls: [],
  tool_summary: {},
  agent_calls: [],
  context_estimate: {
    system_tokens: 8000,
    messages_tokens: 5000,
    tools_definition_tokens: 8000,
    total_tokens: 21000,
  },
  model: "claude-sonnet-4-20250514",
  max_tokens: 16000,
  conversation_turns: 3,
  user_messages_count: 3,
  assistant_messages_count: 2,
  tool_result_count: 1,
  ...overrides,
});

describe("ContextTreemap", () => {
  it("renders without crashing", () => {
    const { container } = render(<ContextTreemap scan={makeScan()} />);
    expect(container.querySelector(".context-treemap")).toBeTruthy();
  });

  it("renders title and file list", () => {
    render(<ContextTreemap scan={makeScan()} />);
    expect(screen.getByText("Context Window")).toBeInTheDocument();
    // Injected files should appear in the file list
    expect(screen.getAllByText("CLAUDE.md")).toHaveLength(2);
    expect(screen.getByText("3.6K")).toBeInTheDocument();
    expect(screen.getByText("2.0K")).toBeInTheDocument();
  });
});
