import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionDetailView } from "../SessionDetailView";

describe("SessionDetailView", () => {
  it("renders back button", () => {
    render(
      <SessionDetailView
        sessionId="test-session-id"
        onBack={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText(/Back/)).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(
      <SessionDetailView
        sessionId="test-session-id"
        onBack={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );
    // Loading spinner is shown via CSS class
    const spinner = document.querySelector(".spinner");
    expect(spinner).toBeInTheDocument();
  });

  it("shows empty state when no prompts found", async () => {
    // getRecentHistory returns empty → no prompts found
    window.api.getRecentHistory = vi.fn().mockResolvedValue([]);

    render(
      <SessionDetailView
        sessionId="test-session-id"
        onBack={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );

    // Wait for loading to finish
    await vi.waitFor(() => {
      expect(screen.getByText("No prompts found")).toBeInTheDocument();
    });
  });
});
