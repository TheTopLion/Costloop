import { describe, expect, it } from "vitest";
import { add, decimal, formatMoney, multiply } from "./decimal";

describe("decimal arithmetic", () => {
  it("avoids binary floating point errors", () => expect(add(decimal("0.1"), decimal("0.2"))).toBe("0.3"));
  it("multiplies quantities and prices exactly", () => expect(multiply(decimal("12.50"), decimal("19.99"))).toBe("249.875"));
  it("canonicalizes and formats money", () => expect(formatMoney(decimal("001234.5"), "KZT")).toBe("KZT 1,234.50"));
  it("rejects exponent notation", () => expect(() => decimal("1e3")).toThrow());
});
