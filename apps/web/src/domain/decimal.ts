/** A canonical base-10 value. Business arithmetic never crosses JS Number. */
export type DecimalString = string & { readonly __decimal: unique symbol };

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function decimal(input: string): DecimalString {
  const value = input.trim();
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`Invalid decimal: ${input}`);
  const negative = match[1] === "-";
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const zero = whole === "0" && !fraction;
  return `${negative && !zero ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}` as DecimalString;
}

function parts(value: DecimalString, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  const digits = whole.replace("-", "") + fraction.padEnd(scale, "0");
  return sign * BigInt(digits);
}

function scaleOf(value: DecimalString): number {
  return value.split(".")[1]?.length ?? 0;
}

function fromScaled(value: bigint, scale: number): DecimalString {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  const at = digits.length - scale;
  return decimal(`${sign}${digits.slice(0, at)}${scale ? `.${digits.slice(at)}` : ""}`);
}

export function add(a: DecimalString, b: DecimalString): DecimalString {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return fromScaled(parts(a, scale) + parts(b, scale), scale);
}

export function multiply(a: DecimalString, b: DecimalString): DecimalString {
  return fromScaled(parts(a, scaleOf(a)) * parts(b, scaleOf(b)), scaleOf(a) + scaleOf(b));
}

export function subtract(a: DecimalString, b: DecimalString): DecimalString {
  return add(a, multiply(b, decimal("-1")));
}

/** Divide by 100 without crossing JavaScript Number (useful for percentage rates). */
export function percentOf(value: DecimalString, percent: DecimalString): DecimalString {
  const product = multiply(value, percent);
  return fromScaled(parts(product, scaleOf(product)), scaleOf(product) + 2);
}

export function compare(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const difference = parts(a, scale) - parts(b, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function formatMoney(value: DecimalString, currency: string, locale = "en"): string {
  const [whole, fraction = ""] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = `${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return locale === "ru" ? `${amount.replace(/,/g, " ")} ${currency}` : `${currency} ${amount}`;
}
