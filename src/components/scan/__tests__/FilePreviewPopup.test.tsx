import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FilePreviewPopup } from "../FilePreviewPopup";

describe("FilePreviewPopup", () => {
  const onClose = vi.fn();
  const anchorRect = new DOMRect(100, 200, 200, 30);

  it("renders file name from path", () => {
    const { container } = render(
      <FilePreviewPopup filePath="workspace/project/CLAUDE.md" anchorRect={anchorRect} onClose={onClose} />,
    );
    const nameEl = container.querySelector(".file-preview-popup-name");
    expect(nameEl).toHaveTextContent("project/CLAUDE.md");
  });

  it("renders full file path", () => {
    const { container } = render(
      <FilePreviewPopup filePath="workspace/project/CLAUDE.md" anchorRect={anchorRect} onClose={onClose} />,
    );
    const pathEl = container.querySelector(".file-preview-popup-path");
    expect(pathEl).toHaveTextContent("workspace/project/CLAUDE.md");
  });

  it("renders ESC close button", () => {
    render(<FilePreviewPopup filePath="/test.md" anchorRect={anchorRect} onClose={onClose} />);
    expect(screen.getByText("ESC")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(<FilePreviewPopup filePath="/test.md" anchorRect={anchorRect} onClose={onClose} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("applies CSS classes for popup layout", () => {
    const { container } = render(
      <FilePreviewPopup filePath="/test.md" anchorRect={anchorRect} onClose={onClose} />,
    );
    expect(container.querySelector(".file-preview-popup")).toBeInTheDocument();
    expect(container.querySelector(".file-preview-popup-header")).toBeInTheDocument();
  });
});
