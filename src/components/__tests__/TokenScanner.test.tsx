import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TokenScanner } from "../TokenScanner";

describe("TokenScanner", () => {
  it("renders header and scan button", () => {
    render(<TokenScanner onBack={vi.fn()} />);
    expect(screen.getByText(/Token Scanner/)).toBeInTheDocument();
    expect(screen.getByText("← Back")).toBeInTheDocument();
  });

  it("shows scanning progress on mount", () => {
    render(<TokenScanner onBack={vi.fn()} />);
    expect(screen.getByText(/Analyzing/)).toBeInTheDocument();
  });

  it("renders token breakdown after scan completes", async () => {
    // Mock scanTokens to return data
    window.api.scanTokens = vi.fn().mockResolvedValue({
      breakdown: {
        claudeMd: { global: 500, project: 300, total: 800 },
        userInput: 200,
        cacheCreation: 100,
        cacheRead: 50,
        output: 300,
        total: 1450,
      },
      insights: ["Test insight"],
      claudeMdSections: [],
    });

    render(<TokenScanner onBack={vi.fn()} />);

    await waitFor(
      () => {
        expect(screen.getByText("CLAUDE.md")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    expect(screen.getByText("Cache Creation")).toBeInTheDocument();
    expect(screen.getByText("User Input")).toBeInTheDocument();
    expect(screen.getByText("AI Response")).toBeInTheDocument();
  });
});
