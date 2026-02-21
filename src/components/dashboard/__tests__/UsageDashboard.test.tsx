import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { UsageDashboard } from "../UsageDashboard";

describe("UsageDashboard", () => {
  it("renders without crashing", async () => {
    render(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Claude")).toBeInTheDocument();
    });
  });

  it("renders provider tabs", async () => {
    render(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Claude")).toBeInTheDocument();
      expect(screen.getByText("Codex")).toBeInTheDocument();
      expect(screen.getByText("Gemini")).toBeInTheDocument();
    });
  });
});
