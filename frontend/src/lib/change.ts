// Show every change both ways: "+0.34 pts (+16%)" for rates, "+120 (+8%)" for counts.

const sign = (v: number) => (v > 0 ? "+" : "");
const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Relative % change from prev to cur, or null when prev is 0 / missing. */
export function relPct(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return round(((cur - prev) / Math.abs(prev)) * 100, 1);
}

/** "+0.3 pts (+16%)" from a current and previous rate. */
export function ptsBothFromValues(cur: number | null | undefined, prev: number | null | undefined, digits = 1): string | null {
  if (cur == null || prev == null) return null;
  const d = round(cur - prev, digits);
  const p = relPct(cur, prev);
  return `${sign(d)}${d} pts${p != null ? ` (${sign(p)}${p}%)` : ""}`;
}

/** "+0.3 pts (+16%)" from a pts change and the current rate (prev = current - pts). */
export function ptsBoth(pts: number | null | undefined, current: number | null | undefined, digits = 1): string | null {
  if (pts == null) return null;
  const base = `${sign(pts)}${round(pts, digits)} pts`;
  if (current == null) return base;
  const p = relPct(current, current - pts);
  return p != null ? `${base} (${sign(p)}${p}%)` : base;
}

/** "+120 (+8%)" from a % change and the current value (prev = current / (1 + pct/100)). */
export function pctBoth(
  pct: number | null | undefined,
  current: number | null | undefined,
  fmt: (abs: number) => string = (a) => Math.round(a).toLocaleString(),
): string | null {
  if (pct == null) return null;
  const pctStr = `${sign(pct)}${pct}%`;
  if (current == null || pct <= -100) return pctStr;
  const prev = current / (1 + pct / 100);
  const abs = current - prev;
  const absStr = `${abs > 0 ? "+" : abs < 0 ? "-" : ""}${fmt(Math.abs(abs))}`;
  return `${absStr} (${pctStr})`;
}

/** "+120 (+8%)" from current and previous counts. */
export function countBothFromValues(
  cur: number | null | undefined,
  prev: number | null | undefined,
  fmt: (abs: number) => string = (a) => Math.round(a).toLocaleString(),
): string | null {
  if (cur == null || prev == null) return null;
  const abs = cur - prev;
  const p = relPct(cur, prev);
  const absStr = `${abs > 0 ? "+" : abs < 0 ? "-" : ""}${fmt(Math.abs(abs))}`;
  return p != null ? `${absStr} (${sign(p)}${p}%)` : absStr;
}
