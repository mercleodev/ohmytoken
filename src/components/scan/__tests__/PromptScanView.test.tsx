import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PromptScanView } from "../PromptScanView";

// Mock child components to isolate PromptScanView
vi.mock("../PromptTimeline", () => ({
  PromptTimeline: () => <div data-testid="prompt-timeline" />,
}));
vi.mock("../ProxyStatusBar", () => ({
  ProxyStatusBar: () => <div data-testid="proxy-status-bar" />,
}));
vi.mock("../ContextWindowGauge", () => ({
  ContextWindowGauge: () => <div data-testid="context-gauge" />,
}));
vi.mock("../ScanDetailPanel", () => ({
  ScanDetailPanel: () => <div data-testid="scan-detail" />,
}));
vi.mock("../FilePreviewPopup", () => ({
  FilePreviewPopup: () => <div data-testid="file-preview" />,
}));

describe("PromptScanView", () => {
  it("renders header with back button in standalone mode", () => {
    render(<PromptScanView onBack={vi.fn()} />);
    expect(screen.getByText("Prompt CT Scan")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("hides header in embedded mode", () => {
    render(<PromptScanView onBack={vi.fn()} embedded />);
    expect(screen.queryByText("Prompt CT Scan")).not.toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(<PromptScanView onBack={vi.fn()} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
