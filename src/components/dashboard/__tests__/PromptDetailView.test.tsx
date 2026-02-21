import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PromptDetailView } from "../PromptDetailView";
import type { PromptScan, UsageLogEntry } from "../../../types";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Mock ContextTreemap
vi.mock("../ContextTreemap", () => ({
  ContextTreemap: () => <div data-testid="context-treemap" />,
}));

// Mock ActionFlowList
vi.mock("../ActionFlowList", () => ({
  ActionFlowList: () => <div data-testid="action-flow-list" />,
}));

// Mock react-syntax-highlighter
vi.mock("react-syntax-highlighter/dist/esm/prism-async-light", () => ({
  default: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism/one-dark", () => ({
  default: {},
}));

const baseScan: PromptScan = {
  request_id: "req-1",
  session_id: "sess-1",
  timestamp: new Date().toISOString(),
  model: "claude-sonnet-4-20250514",
  user_prompt: "Fix the bug in login.ts",
  user_prompt_tokens: 50,
  assistant_response: "I found the issue",
  injected_files: [],
  total_injected_tokens: 0,
  tool_calls: [],
  tool_summary: {},
  agent_calls: [],
  conversation_turns: 3,
  max_tokens: 8192,
  user_messages_count: 1,
  assistant_messages_count: 1,
  tool_result_count: 0,
  context_estimate: {
    system_tokens: 5000,
    messages_tokens: 3000,
    tools_definition_tokens: 1000,
    total_tokens: 9000,
  },
};

const baseUsage: UsageLogEntry = {
  request_id: "req-1",
  session_id: "sess-1",
  timestamp: new Date().toISOString(),
  model: "claude-sonnet-4-20250514",
  request: {
    messages_count: 2,
    tools_count: 0,
    has_system: true,
    max_tokens: 8192,
  },
  response: {
    input_tokens: 5000,
    output_tokens: 1000,
    cache_read_input_tokens: 2000,
    cache_creation_input_tokens: 500,
  },
  cost_usd: 0.015,
  duration_ms: 3500,
};

describe("PromptDetailView", () => {
  it("renders back button", () => {
    render(
      <PromptDetailView scan={baseScan} usage={baseUsage} onBack={vi.fn()} />,
    );
    expect(screen.getByText("‹ Back")).toBeInTheDocument();
  });

  it("renders model name", () => {
    render(
      <PromptDetailView scan={baseScan} usage={baseUsage} onBack={vi.fn()} />,
    );
    const modelElements = screen.getAllByText("Sonnet");
    expect(modelElements.length).toBeGreaterThan(0);
  });

  it("renders prompt text", () => {
    render(
      <PromptDetailView scan={baseScan} usage={baseUsage} onBack={vi.fn()} />,
    );
    expect(screen.getByText("Fix the bug in login.ts")).toBeInTheDocument();
  });

  it("renders quick stats", async () => {
    window.api.getSessionScans = vi.fn().mockResolvedValue([]);

    render(
      <PromptDetailView scan={baseScan} usage={baseUsage} onBack={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Turns")).toBeInTheDocument();
      expect(screen.getByText("Tools")).toBeInTheDocument();
      expect(screen.getByText("Files")).toBeInTheDocument();
    });
  });

  it("renders context gauge percentage", () => {
    render(
      <PromptDetailView scan={baseScan} usage={baseUsage} onBack={vi.fn()} />,
    );
    const pctElements = screen.getAllByText(/%/);
    expect(pctElements.length).toBeGreaterThan(0);
  });
});
