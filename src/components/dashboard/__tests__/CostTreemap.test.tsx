import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostTreemap } from "../CostTreemap";
import type { PromptScan, UsageLogEntry } from "../../../types";

const makeScan = (overrides?: Partial<PromptScan>): PromptScan => ({
  request_id: "req-001",
  session_id: "sess-001",
  timestamp: new Date().toISOString(),
  user_prompt: "Test prompt",
  user_prompt_tokens: 10,
  injected_files: [],
  total_injected_tokens: 0,
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

const makeUsage = (overrides?: Partial<UsageLogEntry>): UsageLogEntry => ({
  timestamp: new Date().toISOString(),
  request_id: "req-001",
  session_id: "sess-001",
  model: "claude-sonnet-4-20250514",
  request: { messages_count: 9, tools_count: 7, has_system: true, max_tokens: 16000 },
  response: {
    input_tokens: 21000,
    output_tokens: 3000,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 14000,
  },
  cost_usd: 0.624,
  duration_ms: 3000,
  ...overrides,
});

describe("CostTreemap", () => {
  it("returns null when no prompts have cost data", () => {
    const { container } = render(
      <CostTreemap prompts={[{ scan: makeScan(), usage: null }]} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders header with total cost when prompts have cost data", () => {
    const prompts = [
      { scan: makeScan({ request_id: "r1" }), usage: makeUsage({ cost_usd: 0.5 }) },
      { scan: makeScan({ request_id: "r2" }), usage: makeUsage({ cost_usd: 0.3 }) },
    ];
    render(<CostTreemap prompts={prompts} />);

    expect(screen.getByText("Session Cost")).toBeInTheDocument();
    // Total cost displayed
    expect(screen.getByText("$0.8000")).toBeInTheDocument();
  });

  it("filters out prompts with zero cost", () => {
    const prompts = [
      { scan: makeScan({ request_id: "r1" }), usage: makeUsage({ cost_usd: 0 }) },
      { scan: makeScan({ request_id: "r2" }), usage: makeUsage({ cost_usd: 1.5 }) },
    ];
    render(<CostTreemap prompts={prompts} />);

    expect(screen.getByText("$1.5000")).toBeInTheDocument();
  });
});
