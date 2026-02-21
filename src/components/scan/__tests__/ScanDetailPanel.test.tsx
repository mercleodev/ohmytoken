import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ScanDetailPanel } from "../ScanDetailPanel";

const baseScan = {
  request_id: "req-1",
  session_id: "sess-1",
  timestamp: new Date().toISOString(),
  model: "claude-sonnet-4-20250514",
  user_prompt: "Fix the login bug",
  user_prompt_tokens: 50,
  injected_files: [
    { path: "project/CLAUDE.md", category: "project", estimated_tokens: 500 },
    { path: "rules/test.md", category: "rules", estimated_tokens: 200 },
  ],
  total_injected_tokens: 700,
  tool_calls: [
    { index: 0, name: "Read", input_summary: "/src/login.ts", timestamp: "2025-01-01T10:00:00Z" },
    { index: 1, name: "Edit", input_summary: "/src/login.ts", timestamp: "2025-01-01T10:01:00Z" },
  ],
  tool_summary: { Read: 1, Edit: 1 },
  agent_calls: [],
  context_estimate: {
    system_tokens: 5000,
    messages_tokens: 3000,
    messages_tokens_breakdown: {
      user_text_tokens: 1000,
      assistant_tokens: 1500,
      tool_result_tokens: 500,
    },
    tools_definition_tokens: 1000,
    total_tokens: 9000,
  },
  max_tokens: 8192,
  conversation_turns: 3,
  user_messages_count: 1,
  assistant_messages_count: 1,
  tool_result_count: 0,
};

const baseUsage = {
  timestamp: new Date().toISOString(),
  request_id: "req-1",
  session_id: "sess-1",
  model: "claude-sonnet-4-20250514",
  request: { messages_count: 2, tools_count: 0, has_system: true, max_tokens: 8192 },
  response: {
    input_tokens: 9000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 4000,
  },
  cost_usd: 0.0234,
  duration_ms: 1200,
};

describe("ScanDetailPanel", () => {
  const onFileClick = vi.fn();

  it("renders user prompt text", () => {
    render(<ScanDetailPanel scan={baseScan} usage={baseUsage} onFileClick={onFileClick} />);
    expect(screen.getByText("Fix the login bug")).toBeInTheDocument();
  });

  it("renders quick stat cards", () => {
    render(<ScanDetailPanel scan={baseScan} usage={baseUsage} onFileClick={onFileClick} />);
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("Turns")).toBeInTheDocument();
  });

  it("expands context breakdown by default", () => {
    render(<ScanDetailPanel scan={baseScan} usage={baseUsage} onFileClick={onFileClick} />);
    expect(screen.getByText("Context Breakdown")).toBeInTheDocument();
    // System legend should be visible in the expanded section
    expect(screen.getByText(/System/)).toBeInTheDocument();
  });

  it("toggles injected files section", () => {
    render(<ScanDetailPanel scan={baseScan} usage={baseUsage} onFileClick={onFileClick} />);
    const filesButton = screen.getByText("Injected Files (2)");
    fireEvent.click(filesButton);
    expect(screen.getByText(/CLAUDE\.md/)).toBeInTheDocument();
  });

  it("toggles actions section", () => {
    render(<ScanDetailPanel scan={baseScan} usage={baseUsage} onFileClick={onFileClick} />);
    const actionsButton = screen.getByText("Actions (2)");
    fireEvent.click(actionsButton);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("applies CSS classes for static styling", () => {
    const { container } = render(
      <ScanDetailPanel scan={baseScan} usage={baseUsage} onFileClick={onFileClick} />,
    );
    expect(container.querySelector(".scan-detail-panel")).toBeInTheDocument();
    expect(container.querySelector(".scan-detail-prompt")).toBeInTheDocument();
    expect(container.querySelector(".scan-detail-stats")).toBeInTheDocument();
  });
});
