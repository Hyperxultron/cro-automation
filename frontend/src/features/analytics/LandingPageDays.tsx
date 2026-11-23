import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download } from "lucide-react";
import { api, type LandingDailyData, type LandingWindowMetrics } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { fmtValue, type DeltaKind } from "./landingDelta";

// Inside the deep dive: this one page, day by day, every metric in its own
// column (Excel style). Same data as the Date-wise tab.

type Key = "sessions" | "bounce_rate" | "added_to_cart_rate" | "conversion_rate" | "orders" | "revenue" | "revenue_per_session";

const COLS: { key: Key; label: string; kind: DeltaKind; lowerIsBetter?: boolean; revenue?: boolean }[] = [
  { key: "sessions", label: "Sessions", kind: "count" },
  { key: "bounce_rate", label: "Bounce", kind: "rate", lowerIsBetter: true },
  { key: "added_to_cart_rate", label: "Add to cart", kind: "rate" },
  { key: "conversion_rate", label: "Conversion", kind: "rate" },
  { key: "orders", label: "Orders", kind: "count", revenue: true },
  { key: "revenue", label: "Revenue", kind: "money", revenue: true },
  { key: "revenue_per_session", label: "Rev / session", kind: "money2", revenue: true },
];

const DAY_OPTIONS = [7, 14, 30, 60];

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });

function total(days: LandingWindowMetrics[], key: Key): number | null {
  const s = days.reduce((a, d) => a + (d.sessions || 0), 0);
  if (key === "sessions") return s;
  if (key === "orders" || key === "revenue") {
    const vals = days.map((d) => d[key]).filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) * 100) / 100 : null;
  }
  if (key === "revenue_per_session") {
    const rev = days.reduce((a, d) => a + (d.revenue ?? 0), 0);
    return s ? Math.round((rev / s) * 100) / 100 : null;
  }
  if (!s) return null;
  return Math.round((days.reduce((a, d) => a + (d[key] ?? 0) * (d.sessions || 0), 0) / s) * 100) / 100;
}

function LandingPageDays({ path, currency, end = null }: { path: string; currency: string | null; end?: string | null }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<LandingDailyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.landingDaily(days, [path], end)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load day-by-day data"));
    return () => {
      alive = false;
    };
  }, [path, days, end]);

  const page = data?.pages[0];
  const cols = COLS.filter((c) => !c.revenue || data?.revenue_available !== false);
  const rows = useMemo(() => (data && page ? data.dates.map((d) => ({ date: d, m: page.days[d] })).filter((r) => r.m) : []), [data, page]);

  // per-column min / max for shading the better days
  const ranges = useMemo(() => {
    const out: Partial<Record<Key, [number, number]>> = {};
    for (const c of COLS) {
      const vals = rows.map((r) => r.m[c.key]).filter((v): v is number => v != null);
      if (vals.length) out[c.key] = [Math.min(...vals), Math.max(...vals)];
    }
    return out;
  }, [rows]);
  const shade = (c: (typeof COLS)[number], v: number | null | undefined) => {
    const r = ranges[c.key];
    if (v == null || !r || r[1] === r[0]) return undefined;
    let t = (v - r[0]) / (r[1] - r[0]);
    if (c.lowerIsBetter) t = 1 - t;
    return { backgroundColor: `rgba(2, 132, 199, ${(0.05 + t * 0.28).toFixed(3)})` };
  };

  const downloadCsv = () => {
    if (!data) return;
    const head = ["Date", ...cols.map((c) => c.label)].join(",");
    const lines = rows.map((r) => [r.date, ...cols.map((c) => r.m[c.key] ?? "")].join(","));
    const tot = ["Total / avg", ...cols.map((c) => total(rows.map((r) => r.m), c.key) ?? "")].join(",");
    const blob = new Blob([[head, ...lines, tot].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "homepage"}-${data.first}-to-${data.last}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="text-blue-500" size={18} />
          <h4 className="font-bold text-slate-900">
            Date-wise (day by day)
            <InfoTip text="This page's numbers for each day (complete days, store time zone, newest on top). Darker cells are that metric's better days. Total / avg adds up sessions, orders and revenue, and gives session-weighted rates." />
          </h4>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-white p-0.5 text-xs">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-md px-2.5 py-1 font-medium ${days === d ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button onClick={downloadCsv} disabled={!data} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <Download size={13} /> Excel (CSV)
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!data && !error && <p className="text-xs text-slate-400">Loading day-by-day numbers…</p>}

      {data && rows.length > 0 && (
        <div className="max-h-[420px] overflow-auto rounded-xl border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b text-xs text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Date</th>
                {cols.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dow = new Date(`${r.date}T00:00:00`).getDay();
                return (
                  <tr key={r.date} className={`border-b border-slate-100 ${dow === 0 || dow === 6 ? "bg-slate-50/60" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs font-medium text-slate-600">{dayLabel(r.date)}</td>
                    {cols.map((c) => (
                      <td key={c.key} className="px-3 py-1.5 text-right tabular-nums text-slate-800" style={shade(c, r.m[c.key])}>
                        {fmtValue(r.m[c.key], c.kind, currency)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-white">
              <tr className="border-t-2 font-semibold">
                <td className="px-3 py-2 text-xs text-slate-700">Total / avg</td>
                {cols.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtValue(total(rows.map((r) => r.m), c.key), c.kind, currency)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {data && Object.keys(data.errors).length > 0 && (
        <p className="mt-2 text-xs text-slate-400">Some numbers couldn't load from Shopify: {Object.values(data.errors).join("; ")}</p>
      )}
    </section>
  );
}

export default LandingPageDays;
