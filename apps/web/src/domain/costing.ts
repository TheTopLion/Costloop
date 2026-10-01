import { add, compare, decimal, multiply, percentOf, type DecimalString } from "./decimal";

export type CurrencyCode = string;

export interface QuoteLineInput {
  quantity: DecimalString;
  unitPrice: DecimalString;
  currency: CurrencyCode;
}

export interface CurrencyRate {
  from: CurrencyCode;
  to: CurrencyCode;
  /** Units of `to` currency for one unit of `from` currency. */
  rate: DecimalString;
}

export function quoteLineTotal(line: QuoteLineInput): DecimalString {
  if (compare(line.quantity, decimal("0")) < 0) throw new Error("Quantity cannot be negative");
  if (compare(line.unitPrice, decimal("0")) < 0) throw new Error("Unit price cannot be negative");
  return multiply(line.quantity, line.unitPrice);
}

export function convertCurrency(
  amount: DecimalString,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: readonly CurrencyRate[],
): DecimalString {
  if (from === to) return amount;
  const matches = rates.filter((candidate) => candidate.from === from && candidate.to === to);
  if (matches.length !== 1) {
    throw new Error(matches.length ? `Ambiguous currency rate: ${from}/${to}` : `Missing currency rate: ${from}/${to}`);
  }
  if (compare(matches[0].rate, decimal("0")) <= 0) throw new Error(`Invalid currency rate: ${from}/${to}`);
  return multiply(amount, matches[0].rate);
}

export interface CommercialTotals {
  base: DecimalString;
  markupPercent: DecimalString;
  markup: DecimalString;
  subtotal: DecimalString;
  taxPercent: DecimalString;
  tax: DecimalString;
  grandTotal: DecimalString;
}

/** Tax is calculated on the marked-up subtotal. Values remain exact decimal strings. */
export function commercialTotals(
  base: DecimalString,
  markupPercent: DecimalString,
  taxPercent: DecimalString,
): CommercialTotals {
  for (const [label, value] of [["Base", base], ["Markup", markupPercent], ["Tax", taxPercent]] as const) {
    if (compare(value, decimal("0")) < 0) throw new Error(`${label} cannot be negative`);
  }
  const markup = percentOf(base, markupPercent);
  const subtotal = add(base, markup);
  const tax = percentOf(subtotal, taxPercent);
  return { base, markupPercent, markup, subtotal, taxPercent, tax, grandTotal: add(subtotal, tax) };
}

export interface ComparableBid {
  state: "comparable";
  supplierId: string;
  rawAmount: DecimalString;
  rawCurrency: CurrencyCode;
  evaluatedAmount: DecimalString;
  comparisonCurrency: CurrencyCode;
  warnings: readonly string[];
}

export interface MissingBid {
  state: "missing";
  supplierId: string;
  reason: string;
}

export interface NonComparableBid {
  state: "non_comparable";
  supplierId: string;
  reason: string;
  rawAmount?: DecimalString;
  rawCurrency?: CurrencyCode;
}

export type ComparisonCell = ComparableBid | MissingBid | NonComparableBid;

export function comparisonCell(input: {
  supplierId: string;
  line?: QuoteLineInput;
  comparisonCurrency: CurrencyCode;
  rates: readonly CurrencyRate[];
  comparable?: boolean;
  reason?: string;
  warnings?: readonly string[];
}): ComparisonCell {
  if (!input.line) return { state: "missing", supplierId: input.supplierId, reason: input.reason ?? "No bid received" };
  const rawAmount = quoteLineTotal(input.line);
  if (input.comparable === false) {
    return {
      state: "non_comparable",
      supplierId: input.supplierId,
      reason: input.reason ?? "Bid is not comparable",
      rawAmount,
      rawCurrency: input.line.currency,
    };
  }
  try {
    return {
      state: "comparable",
      supplierId: input.supplierId,
      rawAmount,
      rawCurrency: input.line.currency,
      evaluatedAmount: convertCurrency(rawAmount, input.line.currency, input.comparisonCurrency, input.rates),
      comparisonCurrency: input.comparisonCurrency,
      warnings: input.warnings ?? [],
    };
  } catch (error) {
    return {
      state: "non_comparable",
      supplierId: input.supplierId,
      reason: error instanceof Error ? error.message : "Currency conversion failed",
      rawAmount,
      rawCurrency: input.line.currency,
    };
  }
}

export interface AwardDecision {
  specificationItemId: string;
  supplierId: string;
}

export function validateAwards(
  requiredItemIds: readonly string[],
  cellsByItem: Readonly<Record<string, readonly ComparisonCell[]>>,
  awards: readonly AwardDecision[],
): void {
  const required = new Set(requiredItemIds);
  const decisions = new Map<string, AwardDecision>();
  for (const award of awards) {
    if (!required.has(award.specificationItemId)) throw new Error(`Award references unknown item: ${award.specificationItemId}`);
    if (decisions.has(award.specificationItemId)) throw new Error(`Duplicate award: ${award.specificationItemId}`);
    const cell = cellsByItem[award.specificationItemId]?.find((candidate) => candidate.supplierId === award.supplierId);
    if (!cell) throw new Error(`Award references missing bid: ${award.specificationItemId}/${award.supplierId}`);
    if (cell.state !== "comparable") throw new Error(`Award must select a comparable bid: ${award.specificationItemId}/${award.supplierId}`);
    decisions.set(award.specificationItemId, award);
  }
  const missing = requiredItemIds.filter((id) => !decisions.has(id));
  if (missing.length) throw new Error(`Missing awards: ${missing.join(", ")}`);
}

export interface ProposalSnapshotLine {
  specificationItemId: string;
  supplierId: string;
  cost: DecimalString;
}

export interface ProposalSnapshot {
  currency: CurrencyCode;
  lines: readonly ProposalSnapshotLine[];
  totals: CommercialTotals;
}

export function createProposalSnapshot(input: {
  requiredItemIds: readonly string[];
  cellsByItem: Readonly<Record<string, readonly ComparisonCell[]>>;
  awards: readonly AwardDecision[];
  currency: CurrencyCode;
  markupPercent: DecimalString;
  taxPercent: DecimalString;
}): ProposalSnapshot {
  validateAwards(input.requiredItemIds, input.cellsByItem, input.awards);
  const lines = input.awards.map((award) => {
    const cell = input.cellsByItem[award.specificationItemId].find(
      (candidate): candidate is ComparableBid => candidate.supplierId === award.supplierId && candidate.state === "comparable",
    );
    if (!cell || cell.comparisonCurrency !== input.currency) throw new Error(`Proposal currency mismatch: ${award.specificationItemId}`);
    return { specificationItemId: award.specificationItemId, supplierId: award.supplierId, cost: cell.evaluatedAmount };
  });
  const base = lines.reduce((total, line) => add(total, line.cost), decimal("0"));
  return { currency: input.currency, lines, totals: commercialTotals(base, input.markupPercent, input.taxPercent) };
}
