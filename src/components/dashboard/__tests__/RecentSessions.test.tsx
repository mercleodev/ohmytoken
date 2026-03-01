import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RecentSessions } from "../RecentSessions";

describe("RecentSessions", () => {
  it("renders title", async () => {
    window.api.getRecentHistory = vi.fn().mockResolvedValue([]);
    window.api.getPromptScans = vi.fn().mockResolvedValue([]);

    render(<RecentSessions onSelectSession={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Recent Prompts")).toBeInTheDocument();
    });
  });

  it("shows empty state when no prompts", async () => {
    window.api.getRecentHistory = vi.fn().mockResolvedValue([]);
    window.api.getPromptScans = vi.fn().mockResolvedValue([]);

    render(<RecentSessions onSelectSession={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No prompts detected yet.")).toBeInTheDocument();
    });
  });

  it("renders prompt items when history exists", async () => {
    window.api.getRecentHistory = vi.fn().mockResolvedValue([
      {
        display: "How do I fix this bug?",
        timestamp: Date.now() - 60000,
        sessionId: "sess-1",
        project: "my-project",
      },
    ]);
    window.api.getPromptScans = vi.fn().mockResolvedValue([]);

    render(<RecentSessions onSelectSession={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/How do I fix this bug/)).toBeInTheDocument();
    });
  });
});
