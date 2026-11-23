import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Search, Table2, X } from "lucide-react";
import { api, type LandingDailyData, type LandingWindowMetrics } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { fmtValue, pagePathLabel, type DeltaKind } from "./landingDelta";

// Date-wise, Excel-style grid: dates down the side, one column per landing
// page. Pick the metric, the number of days and which pages to compare.

type MetricKey = "sessions" | "bounce_rate" | "added_to_cart_rate" | "conversion_rate" | "orders" | "revenue" | "revenue_per_session";

const METRICS: { key: MetricKey; label: string; kind: DeltaKind; lowerIsBetter?: boolean; revenue?: boolean }[] = [
  { key: "sessions", label: "Sessions", kind: "count" },
  { key: "conversion_rate", label: "Conversion rate", kind: "rate" },
  { key: "bounce_rate", label: "Bounce rate", kind: "rate", lowerIsBetter: true },
  { key: "added_to_cart_rate", label: "Add-to-cart rate", kind: "rate" },
  { key: "orders", label: "Orders", kind: "count", revenue: true },
  { key: "revenue", label: "Revenue", kind: "money", revenue: true },
  { key: "revenue_per_session", label: "Revenue / session", kind: "money2", revenue: true },
];

const DAY_OPTIONS = [7, 14, 30, 60];

const HELP_TEXT =
  "Each row is one day (complete days, store time zone, newest on top). Each column is one landing page. " +
  "Pick the metric to compare, how many days, and which pages. Darker cells are that page's better days. " +
  "The 'Total / avg' row adds up sessions, orders and revenue, and gives session-weighted rates. Download saves the grid as a CSV you can open in Excel.";

const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });

function totalFor(days: LandingWindowMetrics[], key: MetricKey): number | null {
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
  const w = days.reduce((a, d) => a + (d[key] ?? 0) * (d.sessions || 0), 0);
  return Math.round((w / s) * 100) / 100;
}

/** "Add a landing page" box: type to search, pick from the list (arrow keys + Enter work too). */
function PageSearch({ pages, onPick }: { pages: { path: string; page_type: string; sessions_30d: number }[]; onPick: (p: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const matches = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return pages.filter((p) => words.every((w) => p.path.includes(w) || p.page_type.toLowerCase().includes(w))).slice(0, 60);
  }, [pages, q]);

  const pick = (p: string) => {
    onPick(p);
    setQ("");
    setHi(0);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-1 rounded-lg border bg-white px-2 py-1 text-xs focus-within:border-blue-300">
        <Plus size={13} className="text-blue-600" />
        <Search size={12} className="text-slate-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && matches[hi]) { e.preventDefault(); pick(matches[hi].path); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search & add a landing page…"
          className="w-56 bg-transparent text-slate-700 outline-none"
        />
      </div>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-96 max-w-[85vw] overflow-y-auto rounded-xl border bg-white py-1 text-xs shadow-xl">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-slate-400">No landing page matches "{q}".</p>
          ) : (
            matches.map((p, i) => (
              <button
                key={p.path}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.path)}
                onMouseEnter={() => setHi(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${i === hi ? "bg-blue-50 text-blue-700" : "text-slate-700"}`}
              >
                <span className="min-w-0 truncate" title={p.path}>{pagePathLabel(p.path)}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{p.page_type} · {p.sessions_30d.toLocaleString()} / 30d</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function LandingDaily({ currency, onOpen, end = null }: { currency: string | null; onOpen: (path: string) => void; end?: string | null }) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<MetricKey>("sessions");
  const [paths, setPaths] = useState<string[] | null>(null); // null = backend picks the top pages
  const [data, setData] = useState<LandingDailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    const key = `${end}|${days}|${(paths ?? []).join("|")}`;
    if (paths != null && loadedKey.current === key) return; // already showing exactly this
    if (paths != null && paths.length === 0) {
      setData((d) => (d ? { ...d, pages: [] } : d));
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api.landingDaily(days, paths ?? undefined, end)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
        const got = d.pages.map((p) => p.path);
        loadedKey.current = `${end}|${days}|${got.join("|")}`;
        if (paths == null) setPaths(got);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load the date-wise grid"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, days, paths?.join("|")]);

  const m = METRICS.find((x) => x.key === metric)!;
  const metrics = METRICS.filter((x) => !x.revenue || data?.revenue_available !== false);

  // per-column min / max for the heat shading
  const ranges = useMemo(() => {
    const out: Record<string, [number, number]> = {};
    for (const p of data?.pages ?? []) {
      const vals = (data?.dates ?? []).map((d) => p.days[d]?.[metric]).filter((v): v is number => v != null);
      if (vals.length) out[p.path] = [Math.min(...vals), Math.max(...vals)];
    }
    return out;
  }, [data, metric]);

  const shade = (path: string, v: number | null | undefined) => {
    const r = ranges[path];
    if (v == null || !r || r[1] === r[0]) return undefined;
    let t = (v - r[0]) / (r[1] - r[0]);
    if (m.lowerIsBetter) t = 1 - t;
    return { backgroundColor: `rgba(2, 132, 199, ${(0.06 + t * 0.32).toFixed(3)})` };
  };

  const removePage = (p: string) => setPaths((cur) => (cur ?? []).filter((x) => x !== p));
  const addPage = (p: string) => {
    if (!p) return;
    setPaths((cur) => (cur ?? []).includes(p) ? cur : [...(cur ?? []), p]);
  };

  const downloadCsv = () => {
    if (!data) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const head = ["Date", ...data.pages.map((p) => p.path)].map(esc).join(",");
    const lines = data.dates.map((d) => [d, ...data.pages.map((p) => {
      const v = p.days[d]?.[metric];
      return v == null ? "" : String(v);
    })].join(","));
    const total = ["Total / avg", ...data.pages.map((p) => {
      const v = totalFor(data.dates.map((d) => p.days[d]).filter(Boolean), metric);
      return v == null ? "" : String(v);
    })].join(",");
    const csv = [head, ...lines, total].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `landing-pages-${metric}-${data.first}-to-${data.last}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selected = paths ?? [];
  const addable = (data?.available_pages ?? []).filter((p) => !selected.includes(p.path));
  const full = selected.length >= (data?.max_pages ?? 15);

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Table2 className="text-blue-500" size={20} />
          <div>
            <h3 className="font-bold text-slate-900">Date-wise comparison<InfoTip text={HELP_TEXT} /></h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {data ? `${weekday(data.first)} - ${weekday(data.last)} · dates down, landing pages across` : "Dates down, landing pages across"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} className="rounded-lg border px-2 py-1.5 text-sm">
            {metrics.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <div className="flex rounded-xl border bg-white p-1 text-sm">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-lg px-2.5 py-1 font-medium ${days === d ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={downloadCsv}
            disabled={!data}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={14} /> Excel (CSV)
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {selected.map((p) => (
          <span key={p} className="inline-flex max-w-[240px] items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
            <span className="truncate" title={p}>{pagePathLabel(p)}</span>
            <button onClick={() => removePage(p)} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`Remove ${p}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        {data && !full && addable.length > 0 && (
          <PageSearch pages={addable} onPick={addPage} />
        )}
        {full && <span className="text-xs text-slate-400">Max {data?.max_pages} pages at a time.</span>}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <p className="mb-2 text-xs text-slate-400">Loading day-by-day numbers from Shopify…</p>}

      {data && data.pages.length > 0 && (
        <div className={`max-h-[560px] overflow-auto rounded-xl border ${loading ? "opacity-60" : ""}`}>
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b text-xs text-slate-500">
                <th className="sticky left-0 z-20 bg-white px-3 py-2 text-left font-medium">Date</th>
                {data.pages.map((p) => (
                  <th key={p.path} className="min-w-[110px] px-3 py-2 text-right font-medium">
                    <button onClick={() => onOpen(p.path)} className="block max-w-[160px] truncate text-right text-slate-700 hover:text-blue-600 hover:underline" title={`${p.path} · click for deep dive`}>
                      {pagePathLabel(p.path)}
                    </button>
                    <span className="text-[10px] font-normal text-slate-400">{p.page_type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.dates.map((d) => {
                const dow = new Date(`${d}T00:00:00`).getDay();
                return (
                  <tr key={d} className={`border-b border-slate-100 ${dow === 0 || dow === 6 ? "bg-slate-50/60" : ""}`}>
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-white px-3 py-1.5 text-xs font-medium text-slate-600">{weekday(d)}</td>
                    {data.pages.map((p) => {
                      const v = p.days[d]?.[metric];
                      return (
                        <td key={p.path} className="px-3 py-1.5 text-right tabular-nums text-slate-800" style={shade(p.path, v)}>
                          {fmtValue(v, m.kind, currency)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-white">
              <tr className="border-t-2 text-sm font-semibold">
                <td className="sticky left-0 bg-white px-3 py-2 text-xs text-slate-700">Total / avg</td>
                {data.pages.map((p) => (
                  <td key={p.path} className="px-3 py-2 text-right tabular-nums text-slate-900">
                    {fmtValue(totalFor(data.dates.map((d) => p.days[d]).filter(Boolean), metric), m.kind, currency)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {data && data.pages.length === 0 && !loading && <p className="text-xs text-slate-400">Pick at least one landing page.</p>}

      {data && Object.keys(data.errors).length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          Some pages couldn't load from Shopify: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join("; ")}
        </p>
      )}
    </section>
  );
}

export default LandingDaily;
