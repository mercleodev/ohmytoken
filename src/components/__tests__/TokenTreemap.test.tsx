import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TokenTreemap } from "../TokenTreemap";

// Mock recharts
vi.mock("recharts", () => ({
  Treemap: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="treemap">{children}</div>
  ),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => <div />,
}));

describe("TokenTreemap", () => {
  it("renders back button", () => {
    render(<TokenTreemap onBack={vi.fn()} />);
    expect(screen.getByText("← Back")).toBeInTheDocument();
  });

  it("renders header title", () => {
    render(<TokenTreemap onBack={vi.fn()} />);
    expect(screen.getByText(/Token/)).toBeInTheDocument();
  });

  it("shows scan progress on mount", () => {
    render(<TokenTreemap onBack={vi.fn()} />);
    const analyzingElements = screen.getAllByText(/Analyzing/);
    expect(analyzingElements.length).toBeGreaterThan(0);
  });

  it("renders model selector", async () => {
    window.api.scanTokens = vi.fn().mockResolvedValue({
      breakdown: {
        claudeMd: { global: 1000, project: 500, total: 1500 },
        userInput: 200,
        cacheCreation: 300,
        cacheRead: 100,
        output: 400,
        total: 2500,
      },
      insights: [],
      claudeMdSections: [],
    });

    render(<TokenTreemap onBack={vi.fn()} />);

    await waitFor(
      () => {
        const select = document.querySelector(".model-select");
        expect(select).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("renders prompt feed section", async () => {
    window.api.scanTokens = vi.fn().mockResolvedValue({
      breakdown: {
        claudeMd: { global: 0, project: 0, total: 0 },
        userInput: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
        total: 0,
      },
      insights: [],
      claudeMdSections: [],
    });
    window.api.getPromptHistory = vi.fn().mockResolvedValue([]);
    window.api.getContextLogs = vi.fn().mockResolvedValue({
      autoInjected: [],
      readFiles: [],
      globSearches: [],
      grepSearches: [],
    });

    render(<TokenTreemap onBack={vi.fn()} />);

    await waitFor(
      () => {
        const promptElements = screen.getAllByText(/Prompt/);
        expect(promptElements.length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
  });
});
