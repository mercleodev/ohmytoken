import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContextWindowGauge } from "../ContextWindowGauge";

describe("ContextWindowGauge", () => {
  const baseProps = {
    totalTokens: 50000,
    model: "claude-sonnet-4-20250514",
    messagesTokens: 20000,
    systemTokens: 15000,
    toolsTokens: 5000,
  };

  it("renders percentage display", () => {
    render(<ContextWindowGauge {...baseProps} />);
    // 50000 / 200000 = 25%
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("used")).toBeInTheDocument();
  });

  it("renders Context Window title", () => {
    render(<ContextWindowGauge {...baseProps} />);
    expect(screen.getByText("Context Window")).toBeInTheDocument();
  });

  it("renders token totals", () => {
    render(<ContextWindowGauge {...baseProps} />);
    expect(screen.getByText("50.0K")).toBeInTheDocument();
  });

  it("renders model name", () => {
    render(<ContextWindowGauge {...baseProps} />);
    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("shows breakdown legend items", () => {
    render(
      <ContextWindowGauge
        {...baseProps}
        messagesBreakdown={{
          user_text_tokens: 8000,
          assistant_tokens: 7000,
          tool_result_tokens: 5000,
        }}
      />,
    );
    expect(screen.getByText(/8\.0K/)).toBeInTheDocument();
  });

  it("applies CSS classes for layout", () => {
    const { container } = render(<ContextWindowGauge {...baseProps} />);
    expect(container.querySelector(".ctx-gauge")).toBeInTheDocument();
    expect(container.querySelector(".ctx-gauge-circle")).toBeInTheDocument();
    expect(container.querySelector(".ctx-gauge-info")).toBeInTheDocument();
  });
});
