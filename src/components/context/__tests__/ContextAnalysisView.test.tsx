import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ContextAnalysisView } from "../ContextAnalysisView";

// Mock recharts
vi.mock("recharts", () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => <div />,
  Cell: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("ContextAnalysisView", () => {
  it("shows loading state initially", () => {
    render(<ContextAnalysisView />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("applies CSS classes for layout", () => {
    const { container } = render(<ContextAnalysisView />);
    expect(container.querySelector(".context-analysis-view")).toBeInTheDocument();
  });
});
