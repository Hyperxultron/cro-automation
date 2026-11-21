import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, Copy, Download, X } from "lucide-react";
import { api, formatMoney, type KpiCalendar, type KpiCalendarDay } from "../../services/api";
import { pctBoth, ptsBothFromValues } from "../../lib/change";

// Overview KPI card popup - "Calendar + related" (template 4 the user picked).
// Left: every day of the last 5 weeks, shaded by value (or by change vs the
// same weekday a week before). Right: the picked day's related numbers.

export type KpiKey = "revenue" | "orders" | "aov" | "cvr" | "sessions" | "rps";

type MetricDef = { label: string; tile: string; kind: "money" | "money2" | "count" | "rate" };
const METRICS: Record<KpiKey, MetricDef> = {
  revenue: { label: "Revenue", tile: "kpi-blue", kind: "money" },
  orders: { label: "Orders", tile: "kpi-amber", kind: "count" },
  aov: { label: "AOV", tile: "kpi-teal", kind: "money2" },
  cvr: { label: "Conversion", tile: "kpi-indigo", kind: "rate" },
  sessions: { label: "Sessions", tile: "kpi-rose", kind: "count" },
  rps: { label: "Revenue / session", tile: "kpi-amber", kind: "money2" },
};
const RELATED: Record<KpiKey, KpiKey[]> = {
  revenue: ["orders", "aov", "sessions"],
  orders: ["revenue", "cvr", "sessions"],
  aov: ["revenue", "orders", "rps"],
  cvr: ["sessions", "orders", "rps"],
  sessions: ["cvr", "revenue", "rps"],
  rps: ["cvr", "aov", "sessions"],
};

// One fetch per page load is enough: these are complete days.
let cache: Promise<KpiCalendar> | null = null;
const loadCalendar = () => {
  if (!cache) cache = api.kpiCalendar(35).catch((e) => { cache = null; throw e; });
  return cache;
};

const shiftIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function fmt(v: number | null | undefined, kind: MetricDef["kind"], currency?: string | null) {
  if (v == null) return "—";
  if (kind === "money") return formatMoney(v, currency);
  if (kind === "money2") return formatMoney(v, currency, 2);
  if (kind === "rate") return `${v}%`;
  return Math.round(v).toLocaleString();
}
function short(v: number | null | undefined, kind: MetricDef["kind"], currency?: string | null) {
  if (v == null) return "—";
  if (kind === "rate") return `${v}%`;
  if (kind === "money2") return formatMoney(v, currency, 2);
  const sym = kind === "money" ? (formatMoney(0, currency).replace(/[\d.,\s]/g, "") || "$") : "";
  if (Math.abs(v) >= 1000) return `${sym}${(v / 1000).toFixed(1)}k`;
  return `${sym}${Math.round(v).toLocaleString()}`;
}
function change(cur: number | null | undefined, prev: number | null | undefined, kind: MetricDef["kind"], currency?: string | null) {
  if (cur == null || prev == null || prev === 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  const text = kind === "rate"
    ? ptsBothFromValues(cur, prev, 2)
    : pctBoth(pct, cur, (a) => (kind === "count" ? Math.round(a).toLocaleString() : formatMoney(a, currency, kind === "money2" ? 2 : 0)));
  return { pct, text: text ?? "" };
}

function Spark({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const w = 110, h = 34, n = values.length - 1 || 1;
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${((i / n) * w).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function KpiPopup({
  metric, title, period, value, changeText, changeDown, focusDate, currency, onClose, onOpenDay,
}: {
  metric: KpiKey;
  title: string;
  period: string;
  value: string;
  changeText?: string;
  changeDown?: boolean;
  focusDate?: string | null;
  currency?: string | null;
  onClose: () => void;
  onOpenDay: (date: string) => void;
}) {
  const [data, setData] = useState<KpiCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"value" | "change">("value");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const def = METRICS[metric];

  useEffect(() => {
    loadCalendar().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Could not load daily numbers"));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const last = data?.last ?? null;
  const day = selected ?? (focusDate && byDate.has(focusDate) ? focusDate : last);

  // Calendar: Monday-start weeks covering first..last.
  const cells = useMemo(() => {
    if (!data) return [];
    const first = data.first;
    const dow = (new Date(`${first}T12:00:00`).getDay() + 6) % 7;
    const start = shiftIso(first, -dow);
    const out: string[] = [];
    for (let d = start; d <= data.last || out.length % 7; d = shiftIso(d, 1)) out.push(d);
    return out;
  }, [data]);

  const val = (d: KpiCalendarDay | undefined, k: KpiKey) => (d ? (d[k] as number | null) : null);
  const shown = (data?.days ?? []).filter((d) => d.date >= (data?.first ?? ""));
  const values = shown.map((d) => val(d, metric)).filter((v): v is number => v != null);
  const lo = Math.min(...values), hi = Math.max(...values);

  const cellStyle = (iso: string) => {
    const d = byDate.get(iso);
    const v = val(d, metric);
    if (!d || iso < (data?.first ?? "") || v == null) return { background: "#f1f5f9", color: "#94a3b8" };
    if (mode === "value") {
      const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      return { background: `rgba(2,132,199,${(0.12 + 0.78 * t).toFixed(2)})`, color: t > 0.55 ? "#fff" : "#0f172a" };
    }
    const c = change(v, val(byDate.get(shiftIso(iso, -7)), metric), def.kind);
    if (!c) return { background: "#f1f5f9", color: "#64748b" };
    const t = Math.min(Math.abs(c.pct) / 30, 1);
    const rgb = c.pct >= 0 ? "16,185,129" : "239,68,68";
    return { background: `rgba(${rgb},${(0.12 + 0.7 * t).toFixed(2)})`, color: t > 0.6 ? "#fff" : "#0f172a" };
  };

  const sel = day ? byDate.get(day) : undefined;
  const selPrev = day ? byDate.get(shiftIso(day, -7)) : undefined;
  const sparkFor = (k: KpiKey) => {
    if (!day) return [];
    return Array.from({ length: 14 }, (_, i) => val(byDate.get(shiftIso(day, i - 13)), k));
  };

  const summary = () => {
    if (!sel || !day) return "";
    const lines = [`${dayLabel(day)} (store time)`, ...[metric, ...RELATED[metric]].map((k) => {
      const m = METRICS[k];
      const c = change(val(sel, k), val(selPrev, k), m.kind, currency);
      return `${m.label}: ${fmt(val(sel, k), m.kind, currency)}${c ? ` (${c.text} vs ${dayLabel(shiftIso(day, -7))})` : ""}`;
    })];
    return lines.join("\n");
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(summary()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const csv = () => {
    const keys: KpiKey[] = ["revenue", "orders", "aov", "cvr", "sessions", "rps"];
    const rows = [["date", ...keys].join(","), ...shown.map((d) => [d.date, ...keys.map((k) => d[k] ?? "")].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ridhi-pulse-daily-${data?.first}-to-${data?.last}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mainChange = sel ? change(val(sel, metric), val(selPrev, metric), def.kind, currency) : null;

  return (
    <div className="kpi-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} by day`}
        className="kpi-pop w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`kpi-tile ${def.tile} relative px-6 py-5 sm:px-8 sm:py-6`}>
          <p className="relative text-sm font-semibold text-white/95">{title}</p>
          <p className="relative text-[11px] font-semibold uppercase tracking-wide text-white/75">{period}</p>
          <div className="relative mt-2 flex flex-wrap items-end gap-3">
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">{value}</h2>
            {changeText && (
              <span className="kpi-chip mb-1.5 flex items-center gap-1 text-xs font-semibold text-white">
                {changeDown ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                {changeText}
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-xl bg-white/20 p-2 text-white hover:bg-white/30">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="p-8 text-sm text-red-600">{error}</p>
        ) : !data ? (
          <p className="p-8 text-sm text-slate-500">Loading every day's numbers…</p>
        ) : (
          <div className="grid lg:grid-cols-[1.25fr_1fr]">
            <div className="border-b border-slate-100 p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {def.label} every day · {dayLabel(data.first)} to {dayLabel(data.last)}
                </p>
                <div className="flex rounded-xl bg-slate-100 p-0.5 text-xs">
                  {([["value", "Value"], ["change", "vs week before"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setMode(k)}
                      className={`rounded-lg px-3 py-1 font-semibold ${mode === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1.5">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
                  <p key={w} className="text-center text-[10px] font-medium text-slate-400">{w}</p>
                ))}
                {cells.map((iso) => {
                  const inRange = iso >= data.first && iso <= data.last;
                  const d = byDate.get(iso);
                  const st = cellStyle(iso);
                  const c = mode === "change" && d ? change(val(d, metric), val(byDate.get(shiftIso(iso, -7)), metric), def.kind) : null;
                  return (
                    <button
                      key={iso}
                      disabled={!inRange}
                      onClick={() => setSelected(iso)}
                      title={inRange ? `${dayLabel(iso)}: ${fmt(val(d, metric), def.kind, currency)}` : undefined}
                      style={inRange ? st : { background: "transparent", color: "#cbd5e1" }}
                      className={`h-12 rounded-lg px-1.5 py-1 text-left text-[10px] leading-tight transition sm:h-14 ${inRange ? "hover:ring-2 hover:ring-slate-300" : "cursor-default"} ${iso === day ? "ring-[2.5px] ring-amber-400" : ""}`}
                    >
                      <b className="block text-[11px]">{Number(iso.slice(8))}</b>
                      {inRange && (mode === "value" ? short(val(d, metric), def.kind, currency) : c ? `${c.pct > 0 ? "+" : ""}${c.pct}%` : "—")}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {mode === "value" ? "Darker = higher." : "Green = up, red = down vs the same weekday a week before."} Click a day to see its numbers. Orange = selected day.
              </p>
            </div>

            <div className="p-5 sm:p-6">
              {day && sel ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{dayLabel(day)} · vs {dayLabel(shiftIso(day, -7))}</p>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <p className="text-3xl font-bold text-slate-900">{fmt(val(sel, metric), def.kind, currency)}</p>
                    {mainChange && (
                      <span className={`mb-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ${mainChange.pct >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {mainChange.text}
                      </span>
                    )}
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Related numbers, same day</p>
                  <div className="mt-2 space-y-2.5">
                    {RELATED[metric].map((k) => {
                      const m = METRICS[k];
                      const c = change(val(sel, k), val(selPrev, k), m.kind, currency);
                      return (
                        <div key={k} className={`kpi-tile ${m.tile} flex items-center justify-between gap-3 rounded-2xl px-4 py-3`}>
                          <div className="relative min-w-0">
                            <p className="text-xs text-white/90">{m.label}</p>
                            <p className="text-xl font-bold text-white">
                              {fmt(val(sel, k), m.kind, currency)}
                              {c && <span className="kpi-chip ml-2 align-middle text-[11px] font-semibold">{c.text}</span>}
                            </p>
                          </div>
                          <Spark values={sparkFor(k)} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {day !== (focusDate ?? last) && (
                      <button onClick={() => onOpenDay(day)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700">
                        <CalendarDays size={14} /> Open this day on Overview
                      </button>
                    )}
                    <button onClick={csv} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                      <Download size={14} /> Download CSV
                    </button>
                    <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy summary"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">No numbers for this day.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
