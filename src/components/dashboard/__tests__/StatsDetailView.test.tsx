import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsDetailView } from "../StatsDetailView";
import type { ScanStats } from "../../../types";

const mockStats: ScanStats = {
  cost_by_time: [],
  tool_frequency: { Read: 245, Edit: 132, Bash: 98 },
  injected_file_tokens: [],
  cache_hit_rate: [],
  cost_by_period: [
    { period: "2026-02-20", cost_usd: 5.5, request_count: 20 },
    { period: "2026-02-21", cost_usd: 3.2, request_count: 15 },
  ],
  summary: {
    total_requests: 487,
    total_cost_usd: 260.12,
    avg_context_tokens: 89420,
    most_used_tool: "Read",
    cache_hit_rate: 91.3,
  },
};

describe("StatsDetailView", () => {
  it("renders summary cards with correct values", () => {
    const onBack = vi.fn();
    render(<StatsDetailView stats={mockStats} onBack={onBack} />);

    expect(screen.getByText("$260.12")).toBeInTheDocument();
    expect(screen.getByText("487")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("renders top tools in frequency order", () => {
    const onBack = vi.fn();
    render(<StatsDetailView stats={mockStats} onBack={onBack} />);

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("245")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("132")).toBeInTheDocument();
  });

  it("renders back button", () => {
    const onBack = vi.fn();
    render(<StatsDetailView stats={mockStats} onBack={onBack} />);

    const backBtn = screen.getByText("‹ Back");
    expect(backBtn).toBeInTheDocument();
  });
});
