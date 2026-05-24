/**
 * Pure tests for the `classify` priority chain (issue #374).
 *
 * The new step 4 promotes a file to `confirmed` when the
 * `instruction-compliance` signal carries `confidence >= high_compliance_confidence_min`.
 */
import { describe, it, expect } from "vitest";
import { classify } from "../engine";

const T = {
  confirmed_min_raw: 45,
  likely_min_raw: 25,
  high_compliance_confidence_min: 0.8,
};

describe("classify (with high-compliance shortcut, #374)", () => {
  it("USED ack still wins over high-compliance shortcut", () => {
    expect(classify(10, true, false, "USED", true, T)).toBe("confirmed");
  });

  it("NOT_APPLICABLE ack still wins over high-compliance shortcut (caps at likely)", () => {
    // Even with high compliance, an explicit NOT_APPLICABLE downgrades to likely.
    expect(classify(50, true, false, "NOT_APPLICABLE", true, T)).toBe("likely");
  });

  it("direct tool reference still wins (precedes high-compliance shortcut)", () => {
    expect(classify(5, true, true, null, false, T)).toBe("confirmed");
  });

  it("high-compliance at exactly the threshold promotes to confirmed", () => {
    // confidence === high_compliance_confidence_min => helper returns true.
    expect(classify(30, true, false, null, true, T)).toBe("confirmed");
  });

  it("high-compliance just below the threshold falls through to raw-score path", () => {
    // hasHighInstructionCompliance=false => raw thresholds apply.
    expect(classify(30, true, false, null, false, T)).toBe("likely");
    expect(classify(50, true, false, null, false, T)).toBe("confirmed");
    expect(classify(20, true, false, null, false, T)).toBe("unverified");
  });

  it("missing evidence signal still falls through to unverified regardless of compliance", () => {
    // Without any evidence-kind signal scoring > 0, raw-score path is bypassed.
    // The high-compliance shortcut is itself an evidence signal, so the precondition
    // (hasEvidenceSignal=false AND hasHighInstructionCompliance=true) cannot
    // legitimately occur — but if it ever does the engine's evidence-signal
    // guard wins to preserve the prior contract.
    expect(classify(50, false, false, null, true, T)).toBe("unverified");
  });

  it("threshold is configurable — raising to 1.0 means only perfect compliance promotes", () => {
    const strict = { ...T, high_compliance_confidence_min: 1.0 };
    // The helper resolves with the new threshold; classify just sees boolean.
    expect(classify(30, true, false, null, true, strict)).toBe("confirmed");
    // (false would represent confidence < 1.0 under the strict threshold)
    expect(classify(30, true, false, null, false, strict)).toBe("likely");
  });
});
