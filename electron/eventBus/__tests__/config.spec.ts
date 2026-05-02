import { describe, expect, it } from "vitest";
import { isHudEnabled } from "../config";

describe("isHudEnabled", () => {
  it("returns true when OMT_HUD_ENABLED is unset", () => {
    expect(isHudEnabled({})).toBe(true);
  });

  it("returns false when OMT_HUD_ENABLED is exactly '0'", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "0" })).toBe(false);
  });

  it("returns true when OMT_HUD_ENABLED is '1'", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "1" })).toBe(true);
  });

  it("returns true when OMT_HUD_ENABLED is empty string (only '0' disables)", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "" })).toBe(true);
  });

  it("returns true for non-'0' values like 'false' (strict literal match)", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "false" })).toBe(true);
  });
});
