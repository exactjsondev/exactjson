export function toFiniteNumber(
  value: unknown,
  options: { allowCommas?: boolean } = {}
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (options.allowCommas) {
      const cleaned = trimmed.replace(/,/g, "");
      if (!cleaned || cleaned.toLowerCase() === "null") return null;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundToOrNull(value: number, decimals: number): number | null {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Number.isFinite(rounded) ? rounded : null;
}
