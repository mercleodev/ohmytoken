import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProxyStatusBar } from "../ProxyStatusBar";

// Mock usePolling hook
vi.mock("../../../hooks", () => ({
  usePolling: vi.fn(),
  useClickOutside: vi.fn(),
}));

describe("ProxyStatusBar", () => {
  it("renders proxy status text", () => {
    render(<ProxyStatusBar />);
    expect(screen.getByText("Proxy starting...")).toBeInTheDocument();
  });

  it("applies CSS classes for layout", () => {
    const { container } = render(<ProxyStatusBar />);
    expect(container.querySelector(".proxy-status-bar")).toBeInTheDocument();
  });
});
