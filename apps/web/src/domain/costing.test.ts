import { describe, expect, it } from "vitest";
import { decimal } from "./decimal";
import {
  commercialTotals,
  comparisonCell,
  convertCurrency,
  createProposalSnapshot,
  quoteLineTotal,
  validateAwards,
  type ComparisonCell,
} from "./costing";

describe("deterministic costing", () => {
  it("calculates quote totals and explicit currency conversion without Number", () => {
    const total = quoteLineTotal({ quantity: decimal("3.5"), unitPrice: decimal("19.99"), currency: "USD" });
    expect(total).toBe("69.965");
    expect(convertCurrency(total, "USD", "KZT", [{ from: "USD", to: "KZT", rate: decimal("500.25") }])).toBe("34999.99125");
  });

  it("does not infer or silently choose currency rates", () => {
    expect(() => convertCurrency(decimal("10"), "USD", "KZT", [])).toThrow("Missing currency rate");
    expect(() => convertCurrency(decimal("10"), "USD", "KZT", [
      { from: "USD", to: "KZT", rate: decimal("500") },
      { from: "USD", to: "KZT", rate: decimal("501") },
    ])).toThrow("Ambiguous currency rate");
  });

  it("applies markup then tax exactly", () => {
    expect(commercialTotals(decimal("1000"), decimal("12.5"), decimal("16"))).toEqual({
      base: "1000", markupPercent: "12.5", markup: "125", subtotal: "1125",
      taxPercent: "16", tax: "180", grandTotal: "1305",
    });
  });
});

describe("comparison, awards, and proposal snapshot", () => {
  const comparable = comparisonCell({
    supplierId: "supplier-a",
    line: { quantity: decimal("2"), unitPrice: decimal("50"), currency: "USD" },
    comparisonCurrency: "KZT",
    rates: [{ from: "USD", to: "KZT", rate: decimal("500") }],
  });
  const cells: Record<string, ComparisonCell[]> = {
    "item-1": [comparable, comparisonCell({ supplierId: "supplier-b", comparisonCurrency: "KZT", rates: [] })],
  };

  it("distinguishes missing and non-comparable cells", () => {
    expect(cells["item-1"][1]).toMatchObject({ state: "missing", reason: "No bid received" });
    expect(comparisonCell({
      supplierId: "supplier-c",
      line: { quantity: decimal("1"), unitPrice: decimal("10"), currency: "EUR" },
      comparisonCurrency: "KZT",
      rates: [],
    })).toMatchObject({ state: "non_comparable", reason: "Missing currency rate: EUR/KZT" });
  });

  it("rejects incomplete, duplicate, and non-comparable awards", () => {
    expect(() => validateAwards(["item-1"], cells, [])).toThrow("Missing awards");
    expect(() => validateAwards(["item-1"], cells, [
      { specificationItemId: "item-1", supplierId: "supplier-a" },
      { specificationItemId: "item-1", supplierId: "supplier-a" },
    ])).toThrow("Duplicate award");
    expect(() => validateAwards(["item-1"], cells, [{ specificationItemId: "item-1", supplierId: "supplier-b" }])).toThrow("comparable bid");
  });

  it("freezes selected evaluated costs into a proposal snapshot", () => {
    const snapshot = createProposalSnapshot({
      requiredItemIds: ["item-1"], cellsByItem: cells,
      awards: [{ specificationItemId: "item-1", supplierId: "supplier-a" }],
      currency: "KZT", markupPercent: decimal("10"), taxPercent: decimal("12"),
    });
    expect(snapshot.lines).toEqual([{ specificationItemId: "item-1", supplierId: "supplier-a", cost: "50000" }]);
    expect(snapshot.totals).toMatchObject({ base: "50000", markup: "5000", tax: "6600", grandTotal: "61600" });
  });
});
