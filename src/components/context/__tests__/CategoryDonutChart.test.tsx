import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CategoryDonutChart } from "../CategoryDonutChart";

// Mock recharts
vi.mock("recharts", () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => <div />,
  Cell: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const testData = [
  { category: "global", totalTokens: 5000, percentage: 50, color: "#8b5cf6" },
  { category: "project", totalTokens: 3000, percentage: 30, color: "#3b82f6" },
  { category: "rules", totalTokens: 2000, percentage: 20, color: "#f59e0b" },
];

describe("CategoryDonutChart", () => {
  it("renders empty state when no data", () => {
    render(<CategoryDonutChart data={[]} totalTokens={0} />);
    expect(screen.getByText("No injected files")).toBeInTheDocument();
  });

  it("renders total tokens in center", () => {
    render(<CategoryDonutChart data={testData} totalTokens={10000} />);
    expect(screen.getByText("10.0K")).toBeInTheDocument();
    expect(screen.getByText("tokens")).toBeInTheDocument();
  });

  it("renders category labels in legend", () => {
    render(<CategoryDonutChart data={testData} totalTokens={10000} />);
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Rules")).toBeInTheDocument();
  });

  it("applies CSS classes for layout", () => {
    const { container } = render(<CategoryDonutChart data={testData} totalTokens={10000} />);
    expect(container.querySelector(".category-donut")).toBeInTheDocument();
    expect(container.querySelector(".category-donut-center")).toBeInTheDocument();
  });
});
