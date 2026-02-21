import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptTimeline } from "../PromptTimeline";

// Mock recharts
vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
}));

const baseScan = {
  request_id: "req-1",
  session_id: "sess-1",
  timestamp: "2025-01-01T10:00:00Z",
  model: "claude-sonnet-4-20250514",
  user_prompt: "Fix bug",
  user_prompt_tokens: 50,
  injected_files: [],
  total_injected_tokens: 0,
  tool_calls: [],
  tool_summary: {},
  agent_calls: [],
  context_estimate: {
    system_tokens: 5000,
    messages_tokens: 3000,
    tools_definition_tokens: 1000,
    total_tokens: 9000,
  },
  max_tokens: 8192,
  conversation_turns: 1,
  user_messages_count: 1,
  assistant_messages_count: 1,
  tool_result_count: 0,
};

const baseUsage = {
  timestamp: "2025-01-01T10:00:00Z",
  request_id: "req-1",
  session_id: "sess-1",
  model: "claude-sonnet-4-20250514",
  request: { messages_count: 2, tools_count: 0, has_system: true, max_tokens: 8192 },
  response: {
    input_tokens: 9000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  cost_usd: 0.02,
  duration_ms: 1000,
};

describe("PromptTimeline", () => {
  const onSelectScan = vi.fn();

  it("shows empty state when no entries", () => {
    render(<PromptTimeline entries={[]} onSelectScan={onSelectScan} />);
    expect(screen.getByText("No scan data yet")).toBeInTheDocument();
  });

  it("renders summary info with entries", () => {
    const entries = [{ scan: baseScan, usage: baseUsage }];
    render(<PromptTimeline entries={entries} onSelectScan={onSelectScan} />);
    expect(screen.getByText(/1 requests/)).toBeInTheDocument();
  });

  it("renders bar chart container", () => {
    const entries = [{ scan: baseScan, usage: baseUsage }];
    render(<PromptTimeline entries={entries} onSelectScan={onSelectScan} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("applies CSS classes for timeline layout", () => {
    const { container } = render(
      <PromptTimeline entries={[{ scan: baseScan, usage: baseUsage }]} onSelectScan={onSelectScan} />,
    );
    expect(container.querySelector(".prompt-timeline")).toBeInTheDocument();
    expect(container.querySelector(".prompt-timeline-header")).toBeInTheDocument();
  });
});
