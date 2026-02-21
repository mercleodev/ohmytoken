import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptScanView } from "../PromptScanView";

// Mock recharts to avoid SVG rendering issues
vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
}));

describe("PromptScanView", () => {
  const onBack = vi.fn();

  it("renders header with title in non-embedded mode", async () => {
    render(<PromptScanView onBack={onBack} />);
    expect(screen.getByText("Prompt CT Scan")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("hides header in embedded mode", () => {
    render(<PromptScanView onBack={onBack} embedded />);
    expect(screen.queryByText("Prompt CT Scan")).not.toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(<PromptScanView onBack={onBack} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("applies CSS classes for layout", () => {
    const { container } = render(<PromptScanView onBack={onBack} />);
    expect(container.querySelector(".prompt-scan-view")).toBeInTheDocument();
    expect(container.querySelector(".prompt-scan-header")).toBeInTheDocument();
  });
});
