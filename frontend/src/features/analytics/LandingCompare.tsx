import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarRange, Search } from "lucide-react";
import { api, type LandingCompareData, type LandingCompareRow, type LandingWindowMetrics } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { Delta, fmtValue, pagePathLabel, type DeltaKind } from "./landingDelta";

// Landing pages: week on week (last 7 complete days vs the 7 before) and
// month on month (last 30 complete days vs the 30 before). Click a page for
// its deep dive.

type Mode = "wow" | "mom";
type SortKey = "sessions" | "sessions_change" | "conversion_change" | "bounce_change" | "revenue" | "revenue_change";

const COLS: { key: keyof LandingWindowMetrics; label: string; kind: DeltaKind; lowerIsBetter?: boolean; revenue?: boolean }[] = [
  { key: "sessions", label: "Sessions", kind: "count" },
  { key: "bounce_rate", label: "Bounce", kind: "rate", lowerIsBetter: true },
  { key: "added_to_cart_rate", label: "Add to cart", kind: "rate" },
  { key: "conversion_rate", label: "Conversion", kind: "rate" },
  { key: "orders", label: "Orders", kind: "count", revenue: true },
  { key: "revenue", label: "Revenue", kind: "money", revenue: true },
  { key: "revenue_per_session", label: "Rev / session", kind: "money2", revenue: true },
];

const HELP_TEXT =
  "Week on week = last 7 complete days vs the 7 days before. Month on month = last 30 complete days vs the 30 days before. " +
  "Today is left out so every window is made of full days. Rates show the change in points and in %. " +
  "Changes on pages with too few sessions are marked 'low data'. Click any page for its full deep dive.";

function diff(a: number | null | undefined, b: number | null | undefined) {
  return a == null || b == null ? null : a - b;
}

function LandingCompare({ currency, onOpen, end = null }: { currency: string | null; onOpen: (path: string) => void; end?: string | null }) {
  const [data, setData] = useState<LandingCompareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("wow");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("sessions");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    api.landingCompare(end)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load the comparison"));
    return () => {
      alive = false;
    };
  }, [end]);

  const cur = mode === "wow" ? "week" : "month";
  const prev = mode === "wow" ? "prev_week" : "prev_month";
  const enoughKey = mode === "wow" ? "week_enough" : "month_enough";

  const types = useMemo(() => Array.from(new Set((data?.pages ?? []).map((p) => p.page_type))).sort(), [data]);

  const rows = useMemo(() => {
    let list: LandingCompareRow[] = data?.pages ?? [];
    list = list.filter((p) => p[cur].sessions > 0 || p[prev].sessions > 0);
    if (typeFilter !== "all") list = list.filter((p) => p.page_type === typeFilter);
    if (search.trim()) list = list.filter((p) => p.path.includes(search.trim().toLowerCase()));
    const score = (p: LandingCompareRow): number | null => {
      const c = p[cur], v = p[prev];
      switch (sort) {
        case "sessions": return c.sessions;
        case "sessions_change": return Math.abs(c.sessions - v.sessions);
        case "conversion_change": return p[enoughKey] ? -(diff(c.conversion_rate, v.conversion_rate) ?? 0) : null; // biggest drops first
        case "bounce_change": return p[enoughKey] ? diff(c.bounce_rate, v.bounce_rate) : null; // biggest rises first
        case "revenue": return c.revenue ?? null;
        case "revenue_change": return Math.abs(diff(c.revenue, v.revenue) ?? 0);
      }
    };
    return [...list].sort((a, b) => (score(b) ?? -Infinity) - (score(a) ?? -Infinity));
  }, [data, cur, prev, enoughKey, typeFilter, search, sort]);

  const visible = showAll ? rows : rows.slice(0, 25);
  const cols = COLS.filter((c) => !c.revenue || data?.revenue_available);

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CalendarRange className="text-blue-500" size={20} />
          <div>
            <h3 className="font-bold text-slate-900">Week on week &amp; month on month<InfoTip text={HELP_TEXT} /></h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {data ? (mode === "wow" ? data.wow_label : data.mom_label) : "Loading from Shopify…"}
            </p>
          </div>
        </div>
        <div className="flex rounded-xl border bg-white p-1 text-sm">
          {(["wow", "mom"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 font-medium ${mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {m === "wow" ? "Week on week" : "Month on month"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!data && !error && <p className="text-sm text-slate-400">Loading comparison…</p>}

      {data && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search page"
                className="w-44 rounded-lg border py-1.5 pl-8 pr-2 text-sm outline-none focus:border-blue-300"
              />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm">
              <option value="all">All page types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border px-2 py-1.5 text-sm">
              <option value="sessions">Sort: Sessions</option>
              <option value="sessions_change">Sort: Biggest traffic change</option>
              <option value="conversion_change">Sort: Biggest conversion drop</option>
              <option value="bounce_change">Sort: Biggest bounce rise</option>
              {data.revenue_available && <option value="revenue">Sort: Revenue</option>}
              {data.revenue_available && <option value="revenue_change">Sort: Biggest revenue change</option>}
            </select>
            <span className="text-xs text-slate-400">
              {data.windows[cur].label} vs {data.windows[prev].label}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-slate-400">No pages match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-400">
                    <th className="pb-3 pr-4 font-medium">Page</th>
                    {cols.map((c) => <th key={c.key} className="pb-3 pr-4 text-right font-medium">{c.label}</th>)}
                    <th className="pb-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.path} onClick={() => onOpen(p.path)} className="cursor-pointer border-b last:border-0 hover:bg-slate-50">
                      <td className="max-w-[300px] py-3 pr-4">
                        <span className="block truncate font-medium text-slate-800" title={p.path}>{pagePathLabel(p.path)}</span>
                        <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{p.page_type}</span>
                      </td>
                      {cols.map((c) => (
                        <td key={c.key} className="py-3 pr-4 text-right align-top">
                          <div className="tabular-nums text-slate-800">{fmtValue(p[cur][c.key], c.kind, currency)}</div>
                          <Delta
                            cur={p[cur][c.key]}
                            prev={p[prev][c.key]}
                            kind={c.kind}
                            currency={currency}
                            lowerIsBetter={c.lowerIsBetter}
                            enough={c.key === "sessions" || p[enoughKey]}
                          />
                          <div className="text-[10px] text-slate-400">was {fmtValue(p[prev][c.key], c.kind, currency)}</div>
                        </td>
                      ))}
                      <td className="py-3 text-right">
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-blue-600">
                          Deep dive <ArrowRight size={12} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 25 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-4 text-sm font-semibold text-blue-600 hover:underline">
              {showAll ? "Show top 25" : `Show all ${rows.length} pages`}
            </button>
          )}
          {Object.keys(data.errors).length > 0 && (
            <p className="mt-3 text-xs text-slate-400">
              Some parts couldn't load from Shopify: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join("; ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default LandingCompare;
