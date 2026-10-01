const UNIT_ALIASES: Readonly<Record<string, string>> = {
  "pc": "each", "pcs": "each", "piece": "each", "pieces": "each", "each": "each", "ea": "each", "шт": "each", "шт.": "each",
  "hour": "h", "hours": "h", "hr": "h", "hrs": "h", "h": "h", "ч": "h", "час": "h", "часов": "h",
  "m2": "m2", "m²": "m2", "м2": "m2", "м²": "m2", "кв.м.": "m2",
  "m3": "m3", "m³": "m3", "м3": "m3", "м³": "m3", "куб.м": "m3",
  "kg": "kg", "кг": "kg",
};

export function normalizeUnit(unit: string | null | undefined): string | null {
  const raw = unit?.normalize("NFKC").trim().toLocaleLowerCase();
  if (!raw) return null;
  return UNIT_ALIASES[raw] ?? raw;
}
