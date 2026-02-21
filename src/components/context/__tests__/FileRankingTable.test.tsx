import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FileRankingTable } from "../FileRankingTable";

// Mock FilePreviewPopup
vi.mock("../../scan/FilePreviewPopup", () => ({
  FilePreviewPopup: () => <div data-testid="file-preview" />,
}));

const testFiles = [
  { path: "global/CLAUDE.md", category: "global" as const, injectionCount: 5, cumulativeTokens: 2500, percentOfTotal: 50 },
  { path: "project/rules.md", category: "rules" as const, injectionCount: 3, cumulativeTokens: 1500, percentOfTotal: 30 },
];

describe("FileRankingTable", () => {
  it("renders empty state", () => {
    render(<FileRankingTable files={[]} />);
    expect(screen.getByText("No injected files")).toBeInTheDocument();
  });

  it("renders file rows", () => {
    render(<FileRankingTable files={testFiles} />);
    expect(screen.getByText("global/CLAUDE.md")).toBeInTheDocument();
    expect(screen.getByText("project/rules.md")).toBeInTheDocument();
  });

  it("renders category badges", () => {
    render(<FileRankingTable files={testFiles} />);
    expect(screen.getByText("GLBL")).toBeInTheDocument();
    expect(screen.getByText("RULE")).toBeInTheDocument();
  });

  it("renders injection counts", () => {
    render(<FileRankingTable files={testFiles} />);
    expect(screen.getByText("5x")).toBeInTheDocument();
    expect(screen.getByText("3x")).toBeInTheDocument();
  });

  it("applies CSS classes for table layout", () => {
    const { container } = render(<FileRankingTable files={testFiles} />);
    expect(container.querySelector(".file-ranking-table")).toBeInTheDocument();
    expect(container.querySelector(".file-ranking-header")).toBeInTheDocument();
  });
});
