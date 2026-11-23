import { countBothFromValues, ptsBothFromValues } from "../../lib/change";
import { formatMoney } from "../../services/api";

// Shared bits for the Landing Pages WoW / MoM table and the per-page deep dive.

export type DeltaKind = "count" | "rate" | "money" | "money2";

export const fmtValue = (v: number | null | undefined, kind: DeltaKind, currency: string | null) => {
  if (v == null) return "—";
  if (kind === "rate") return `${v}%`;
  if (kind === "money") return formatMoney(v, currency);
  if (kind === "money2") return formatMoney(v, currency, 2);
  return Math.round(v).toLocaleString();
};

/** "+120 (+8%)" / "+0.4 pts (+12%)" coloured green when it's good, red when it's bad. */
export function Delta({ cur, prev, kind, currency = null, lowerIsBetter = false, enough = true, className = "" }: {
  cur: number | null | undefined;
  prev: number | null | undefined;
  kind: DeltaKind;
  currency?: string | null;
  lowerIsBetter?: boolean;
  enough?: boolean;
  className?: string;
}) {
  if (cur == null || prev == null) return <span className={`text-[11px] text-slate-400 ${className}`}>—</span>;
  if (!enough) return <span className={`text-[11px] text-slate-400 ${className}`} title="Too few sessions to judge the change">low data</span>;
  const text = kind === "rate"
    ? ptsBothFromValues(cur, prev)
    : countBothFromValues(cur, prev, kind === "count" ? undefined : (a) => fmtValue(a, kind, currency));
  const d = cur - prev;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const cls = Math.abs(d) < 1e-9 ? "text-slate-400" : good ? "text-emerald-600" : "text-red-600";
  return <span className={`text-[11px] font-medium tabular-nums ${cls} ${className}`}>{text}</span>;
}

export const pagePathLabel = (p: string) => (p === "/" ? "/ (homepage)" : p);
