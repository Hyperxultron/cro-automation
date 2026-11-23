import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import LandingGrids from "./LandingGrids";
import LandingCompare from "./LandingCompare";
import LandingDaily from "./LandingDaily";
import LandingDeepDive from "./LandingDeepDive";
import { AlertTriangle, MonitorSmartphone, Route, Search, Share2 } from "lucide-react";
import { api, type LandingRange, formatMoney, type DashboardSummary, type LandingPagesData, type LandingSplitRow } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";
import { ptsBoth } from "../../lib/change";

// Landing pages, page types and bounce rate (manager checklist, section 5).

type SortKey = "sessions" | "bounce_rate" | "conversion_rate" | "revenue_per_session" | "bounce_change_pts";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

// lowerIsBetter: bounce going up is bad (red); conversion going up is good (green).
function Change({ pts, cur, lowerIsBetter = false }: { pts: number | null | undefined; cur?: number | null; lowerIsBetter?: boolean }) {
  if (pts == null) return null;
  const good = lowerIsBetter ? pts < 0 : pts > 0;
  const cls = pts === 0 ? "text-slate-400" : good ? "text-emerald-600" : "text-red-600";
  return <span className={`ml-1 text-[11px] ${cls}`}>{ptsBoth(pts, cur)}</span>;
}

function BounceBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="w-12 text-right tabular-nums text-slate-700">{value}%</span>
    </div>
  );
}

function SplitTable({ title, help, icon, rows, minSessions, period, showShare = false }: {
  title: string;
  period: string;
  help: string;
  icon: ReactNode;
  rows: LandingSplitRow[];
  minSessions: number;
  showShare?: boolean;
}) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start gap-2">
        {icon}
        <div>
          <h3 className="font-bold text-slate-900">{title}<InfoTip text={help} /></h3>
          <p className="mt-0.5 text-xs text-slate-400">{period}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">No session data for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-400">
                <th className="py-2 pr-4 font-medium">{showShare ? "Page type" : "Segment"}</th>
                <th className="py-2 pr-4 text-right font-medium">Sessions</th>
                {showShare && <th className="py-2 pr-4 text-right font-medium">Share</th>}
                <th className="py-2 pr-4 font-medium">Bounce rate</th>
                <th className="py-2 pr-4 text-right font-medium">Add to cart</th>
                <th className="py-2 text-right font-medium">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{r.label}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.sessions.toLocaleString()}</td>
                  {showShare && <td className="py-2.5 pr-4 text-right text-slate-600">{pct(r.share_of_sessions)}</td>}
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center">
                      <BounceBar value={r.bounce_rate} />
                      <Change pts={r.bounce_change_pts} cur={r.bounce_rate} lowerIsBetter />
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{pct(r.added_to_cart_rate)}</td>
                  <td className="py-2.5 text-right text-slate-700">
                    {r.sessions < minSessions ? <span className="text-xs text-slate-400">Too few sessions</span> : <>{pct(r.conversion_rate)}<Change pts={r.conversion_change_pts} cur={r.conversion_rate} /></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type TabKey = "pages" | "compare" | "daily" | "breakdown" | "grids";
// Priority order: the page list first, then how pages moved, then splits.
const TABS: { key: TabKey; label: string }[] = [
  { key: "pages", label: "1. All landing pages" },
  { key: "compare", label: "2. Week / Month compare" },
  { key: "daily", label: "3. Date-wise" },
  { key: "breakdown", label: "4. Page type, source, device" },
  { key: "grids", label: "5. Page × source grids" },
];

const pathLabel = (p: string) => (p === "/" ? "/ (homepage)" : p);

const RANGES: { key: LandingRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: 7, label: "Last 7 days" },
  { key: 28, label: "Last 28 days" },
];

function LandingPages() {
  const [days, setDays] = useState<LandingRange>(28);
  const [data, setData] = useState<LandingPagesData | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("sessions");
  const [showAll, setShowAll] = useState(false);
  const [deepPath, setDeepPath] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.summary().catch(() => null as DashboardSummary | null), api.landingPages(days)])
      .then(([s, d]) => {
        if (!alive) return;
        if (s) setCurrency(s.store.currency);
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load landing pages"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  const pickDays = (d: LandingRange) => {
    if (d === days) return;
    setLoading(true);
    setData(null); // never show the old range's numbers under the new button
    setDays(d);
  };

  const types = useMemo(() => Array.from(new Set((data?.pages ?? []).map((p) => p.page_type))).sort(), [data]);
  const flaggedCount = useMemo(() => (data?.pages ?? []).filter((p) => p.bounce_flag).length, [data]);

  const rows = useMemo(() => {
    let list = data?.pages ?? [];
    if (typeFilter !== "all") list = list.filter((p) => p.page_type === typeFilter);
    if (flaggedOnly) list = list.filter((p) => p.bounce_flag);
    if (search.trim()) list = list.filter((p) => p.path.includes(search.trim().toLowerCase()));
    return [...list].sort((a, b) => ((b[sort] ?? -Infinity) as number) - ((a[sort] ?? -Infinity) as number));
  }, [data, typeFilter, flaggedOnly, search, sort]);

  const visible = showAll ? rows : rows.slice(0, 15);
  const worstCvr = useMemo(
    () => (data?.pages ?? [])
      .filter((p) => p.conversion_change_pts != null && p.conversion_change_pts < 0)
      .sort((a, b) => (a.conversion_change_pts ?? 0) - (b.conversion_change_pts ?? 0))[0] ?? null,
    [data],
  );
  const [tab, setTabState] = useState<TabKey>(() => {
    const t = localStorage.getItem("landingTab") as TabKey | null;
    return t && TABS.some((x) => x.key === t) ? t : "pages";
  });
  const [seen, setSeen] = useState<Set<TabKey>>(() => new Set([tab]));
  const setTab = (t: TabKey) => {
    setTabState(t);
    setSeen((s) => (s.has(t) ? s : new Set(s).add(t)));
    localStorage.setItem("landingTab", t);
  };
  const fixedWindow = tab === "compare" || tab === "daily";
  const closeDeep = useCallback(() => setDeepPath(null), []);
  const minSessions = data?.min_sessions ?? 100;

  return (
    <div className="space-y-4">
      {/* 1. Header + period */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Main / Analytics</p>
          <h2 className="text-2xl font-bold text-slate-900">Landing Pages &amp; Bounce<InfoTip text={`${data?.bounce_definition ?? ""} Pages with fewer than ${minSessions} sessions are marked "Too few sessions" because their rates jump around too much to judge.`} /></h2>
          <p className="mt-1 text-sm text-slate-500">
            {fixedWindow
              ? "This tab uses its own fixed windows (complete days only)."
              : data ? <>{data.window_label} · changes vs {data.compare_label}</> : "Where visitors land, which pages lose them, and which pages bring orders."}
          </p>
        </div>
        <div className={`flex rounded-xl border bg-white p-1 text-sm ${fixedWindow ? "opacity-40" : ""}`} title={fixedWindow ? "Not used on this tab" : undefined}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => pickDays(r.key)}
              disabled={fixedWindow}
              className={`rounded-lg px-3 py-1.5 font-medium ${days === r.key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && !data && (
        <p className="text-sm text-slate-400">Loading {RANGES.find((r) => r.key === days)?.label ?? ""} from Shopify…</p>
      )}

      {data && (
        <>
          {/* 2. Key numbers - what needs attention first */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <button
              onClick={() => { setTab("pages"); setFlaggedOnly((v) => !v); }}
              className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-red-200 ${flaggedOnly ? "border-red-300 ring-2 ring-red-100" : ""}`}
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <AlertTriangle size={14} className="text-red-500" /> Bounce worse than usual
              </p>
              <p className={`mt-1 text-2xl font-bold ${flaggedCount ? "text-red-600" : "text-slate-900"}`}>{flaggedCount}</p>
              <p className="cro-note text-xs text-slate-400">{data.bounce_flag_pts}+ pts above previous period · {flaggedOnly ? "showing only these" : "click to filter"}</p>
            </button>
            <button
              onClick={() => worstCvr && setDeepPath(worstCvr.path)}
              disabled={!worstCvr}
              className="rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-red-200"
            >
              <p className="text-xs font-medium text-slate-500">Biggest conversion drop</p>
              <p className="mt-1 truncate text-lg font-bold text-slate-900" title={worstCvr?.path}>{worstCvr ? pathLabel(worstCvr.path) : "None"}</p>
              <p className="cro-note text-xs text-slate-400">
                {worstCvr ? <><span className="text-red-600">{ptsBoth(worstCvr.conversion_change_pts, worstCvr.conversion_rate)}</span> · click for deep dive</> : "no page dropped with enough sessions"}
              </p>
            </button>
            <button
              onClick={() => data.pages[0] && setDeepPath(data.pages[0].path)}
              className="rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-blue-200"
            >
              <p className="text-xs font-medium text-slate-500">Top landing page</p>
              <p className="mt-1 truncate text-lg font-bold text-slate-900" title={data.pages[0]?.path}>{data.pages[0] ? pathLabel(data.pages[0].path) : "—"}</p>
              <p className="cro-note text-xs text-slate-400">
                {data.pages[0] ? `${data.pages[0].sessions.toLocaleString()} sessions · bounce ${pct(data.pages[0].bounce_rate)} · CVR ${pct(data.pages[0].conversion_rate)}` : ""}
              </p>
            </button>
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Landing pages with visits</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{data.pages.length.toLocaleString()}</p>
              <p className="cro-note text-xs text-slate-400">{data.pages.filter((p) => !p.too_few_sessions).length} with {minSessions}+ sessions</p>
            </div>
          </div>

          {/* 3. Tabs, in priority order */}
          <div className="sticky top-0 z-30 -mx-1 flex gap-1 overflow-x-auto rounded-xl border bg-white p-1 text-sm shadow-sm">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-medium ${tab === t.key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={tab === "pages" ? "" : "hidden"}>
          <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900">Landing pages<InfoTip text={HELP.landingPages} /></h3>
                <p className="mt-0.5 text-xs text-slate-400">{data.window_label}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  <option value="bounce_rate">Sort: Bounce rate</option>
                  <option value="bounce_change_pts">Sort: Bounce change</option>
                  <option value="conversion_rate">Sort: Conversion</option>
                  {data.revenue_available && <option value="revenue_per_session">Sort: Revenue / session</option>}
                </select>
              </div>
            </div>
            <p className="cro-note mb-3 text-xs text-slate-500">{data.revenue_note} Click any page for its deep dive.</p>
            {rows.length === 0 ? (
              <p className="text-xs text-slate-400">No pages match.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-400">
                      <th className="pb-3 pr-4 font-medium">Page</th>
                      <th className="pb-3 pr-4 text-right font-medium">Sessions</th>
                      <th className="pb-3 pr-4 font-medium">Bounce rate</th>
                      <th className="pb-3 pr-4 text-right font-medium">Add to cart</th>
                      <th className="pb-3 pr-4 text-right font-medium">Conversion</th>
                      {data.revenue_available && <th className="pb-3 pr-4 text-right font-medium">Revenue</th>}
                      {data.revenue_available && <th className="pb-3 pr-4 text-right font-medium">Revenue / session</th>}
                      <th className="pb-3 text-right font-medium">Top source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.path} onClick={() => setDeepPath(p.path)} title="Click for this page's deep dive (WoW / MoM)" className={`cursor-pointer border-b last:border-0 hover:bg-slate-50 ${p.bounce_flag ? "bg-red-50/40" : ""}`}>
                        <td className="max-w-[320px] py-3 pr-4">
                          <div className="flex items-center gap-2">
                            {p.bounce_flag && <AlertTriangle size={14} className="shrink-0 text-red-500" />}
                            <span className="truncate font-medium text-slate-800" title={p.path}>{p.path === "/" ? "/ (homepage)" : p.path}</span>
                          </div>
                          <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{p.page_type}</span>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-700">{p.sessions.toLocaleString()}</td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center">
                            <BounceBar value={p.bounce_rate} />
                            <Change pts={p.bounce_change_pts} cur={p.bounce_rate} lowerIsBetter />
                          </div>
                          {p.bounce_flag && p.previous_bounce_rate != null && (
                            <p className="mt-0.5 text-[11px] text-red-600">usually {p.previous_bounce_rate}%</p>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right text-slate-600">{pct(p.added_to_cart_rate)}</td>
                        <td className="py-3 pr-4 text-right text-slate-700">
                          {p.too_few_sessions ? <span className="text-xs text-slate-400">Too few sessions</span> : <>{pct(p.conversion_rate)}<Change pts={p.conversion_change_pts} cur={p.conversion_rate} /></>}
                        </td>
                        {data.revenue_available && <td className="py-3 pr-4 text-right font-semibold text-slate-900">{p.revenue == null ? "—" : formatMoney(p.revenue, currency)}</td>}
                        {data.revenue_available && (
                          <td className="py-3 pr-4 text-right text-slate-700">
                            {p.revenue_per_session == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(p.revenue_per_session)}
                          </td>
                        )}
                        <td className="py-3 text-right text-slate-600">
                          {p.top_source ?? "—"}
                          {p.top_source_share != null && <span className="ml-1 text-xs text-slate-400">({p.top_source_share}%)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > 15 && (
              <button onClick={() => setShowAll((v) => !v)} className="mt-4 text-sm font-semibold text-blue-600 hover:underline">
                {showAll ? "Show top 15" : `Show all ${rows.length} pages`}
              </button>
            )}
          </section>
          </div>

          {seen.has("compare") && (
            <div className={tab === "compare" ? "" : "hidden"}>
              <LandingCompare currency={currency} onOpen={setDeepPath} />
            </div>
          )}

          {seen.has("daily") && (
            <div className={tab === "daily" ? "" : "hidden"}>
              <LandingDaily currency={currency} onOpen={setDeepPath} />
            </div>
          )}

          <div className={tab === "breakdown" ? "space-y-4" : "hidden"}>
            <SplitTable title="By page type" help={HELP.pageTypes} icon={<Route className="text-blue-500" size={20} />} rows={data.page_types} minSessions={minSessions} period={data.window_label} showShare />
            <div className="grid gap-4 xl:grid-cols-2">
              <SplitTable title="Bounce by traffic source" help={HELP.bounceBySource} icon={<Share2 className="text-blue-500" size={20} />} rows={data.by_source} minSessions={minSessions} period={data.window_label} />
              <SplitTable title="Bounce by device" help={HELP.bounceByDevice} icon={<MonitorSmartphone className="text-blue-500" size={20} />} rows={data.by_device} minSessions={minSessions} period={data.window_label} />
            </div>
          </div>

          {seen.has("grids") && (
            <div className={tab === "grids" ? "" : "hidden"}>
              <LandingGrids range={days} />
            </div>
          )}

          {Object.keys(data.errors).length > 0 && (
            <p className="text-xs text-slate-400">
              Some parts couldn't load from Shopify: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join("; ")}
            </p>
          )}
        </>
      )}

      {deepPath && <LandingDeepDive path={deepPath} currency={currency} onClose={closeDeep} />}
    </div>
  );
}

export default LandingPages;
