import { describe, expect, it } from "vitest";
import { normalizeUnit } from "./normalization";

describe("normalizeUnit", () => {
  it.each([["pcs", "each"], ["шт.", "each"], ["hour", "h"], ["м²", "m2"]])("maps %s to %s", (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });

  it("preserves an unknown normalized unit", () => expect(normalizeUnit("  Set  ")).toBe("set"));
});
