import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PromptTimeline } from "../PromptTimeline";

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Cell: () => <div />,
}));

const makeScan = (overrides: Record<string, unknown> = {}) => ({
  request_id: "req-1",
  session_id: "sess-1",
  timestamp: new Date().toISOString(),
  user_prompt: "test prompt",
  user_prompt_tokens: 100,
  injected_files: [],
  total_injected_tokens: 0,
  tool_calls: [],
  tool_summary: {},
  agent_calls: [],
  context_estimate: {
    system_tokens: 1000,
    messages_tokens: 2000,
    tools_definition_tokens: 500,
    total_tokens: 3500,
  },
  model: "claude-sonnet-4-20250514",
  max_tokens: 16000,
  conversation_turns: 1,
  user_messages_count: 1,
  assistant_messages_count: 0,
  tool_result_count: 0,
  ...overrides,
});

const makeUsage = (overrides: Record<string, unknown> = {}) => ({
  timestamp: new Date().toISOString(),
  request_id: "req-1",
  session_id: "sess-1",
  model: "claude-sonnet-4-20250514",
  request: { messages_count: 1, tools_count: 0, has_system: true, max_tokens: 16000 },
  response: { input_tokens: 3500, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  cost_usd: 0.05,
  duration_ms: 2000,
  ...overrides,
});

describe("PromptTimeline", () => {
  it("shows empty state when no entries", () => {
    render(
      <PromptTimeline entries={[]} onSelectScan={vi.fn()} />,
    );
    expect(screen.getByText("No scan data yet")).toBeInTheDocument();
  });

  it("renders request count and total cost", () => {
    const entries = [
      { scan: makeScan(), usage: makeUsage() },
      { scan: makeScan({ request_id: "req-2" }), usage: makeUsage({ request_id: "req-2", cost_usd: 0.03 }) },
    ];
    render(
      <PromptTimeline entries={entries} onSelectScan={vi.fn()} />,
    );
    expect(screen.getByText(/2 requests/)).toBeInTheDocument();
  });

  it("renders bar chart when entries exist", () => {
    const entries = [{ scan: makeScan(), usage: makeUsage() }];
    render(
      <PromptTimeline entries={entries} onSelectScan={vi.fn()} />,
    );
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });
});
