import { describe, expect, it } from "vitest";
import { isHudEnabled } from "../config";

describe("isHudEnabled", () => {
  it("returns false when OMT_HUD_ENABLED is unset (default-off for v1.0.0)", () => {
    expect(isHudEnabled({})).toBe(false);
  });

  it("returns true when OMT_HUD_ENABLED is exactly '1' (explicit opt-in)", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "1" })).toBe(true);
  });

  it("returns false when OMT_HUD_ENABLED is '0'", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "0" })).toBe(false);
  });

  it("returns false when OMT_HUD_ENABLED is empty string (only '1' enables)", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "" })).toBe(false);
  });

  it("returns false for non-'1' truthy strings like 'true' (strict literal match)", () => {
    expect(isHudEnabled({ OMT_HUD_ENABLED: "true" })).toBe(false);
  });
});
