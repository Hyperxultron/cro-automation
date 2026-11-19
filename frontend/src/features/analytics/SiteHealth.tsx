import { useEffect, useState } from "react";
import { Gauge, Info, Search, Smartphone } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type SiteHealthData, type Vital, type VitalRating, type VitalsRow } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";

// Site health and behaviour (manager checklist, section 7).

const RATING: Record<Exclude<VitalRating, null>, { label: string; tile: string; text: string; dot: string }> = {
  good: { label: "Good", tile: "border-emerald-200 bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  needs_improvement: { label: "Needs work", tile: "border-amber-200 bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  poor: { label: "Poor", tile: "border-red-200 bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

const METRICS = [
  { key: "lcp", name: "Loading (LCP)", what: "Main image / text visible", fmt: (v: number) => `${(v / 1000).toFixed(2)} s`, limit: "good ≤ 2.5 s" },
  { key: "inp", name: "Responsiveness (INP)", what: "Page reacts to a tap", fmt: (v: number) => `${Math.round(v)} ms`, limit: "good ≤ 200 ms" },
  { key: "cls", name: "Visual stability (CLS)", what: "Page doesn't jump around", fmt: (v: number) => v.toFixed(2), limit: "good ≤ 0.1" },
] as const;

function changeText(key: "lcp" | "inp" | "cls", change: number | null | undefined) {
  if (change == null || change === 0) return <span className="text-slate-400">no change vs previous period</span>;
  // Lower is better for every web vital: a rise is red.
  const cls = change > 0 ? "text-red-600" : "text-emerald-600";
  const txt = key === "lcp" ? `${(change / 1000).toFixed(2)} s` : key === "inp" ? `${change} ms` : change.toFixed(3);
  return <span className={cls}>{change > 0 ? "+" : ""}{txt} vs previous period</span>;
}

function VitalTile({ metric, vital }: { metric: (typeof METRICS)[number]; vital: Vital }) {
  const r = vital.rating ? RATING[vital.rating] : null;
  return (
    <div className={`rounded-2xl border p-5 ${r ? r.tile : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">{metric.name}</p>
        {r && (
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${r.text}`}>
            <span className={`h-2 w-2 rounded-full ${r.dot}`} />
            {r.label}
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-bold text-slate-900">{vital.p75 == null ? "—" : metric.fmt(vital.p75)}</p>
      <p className="mt-1 text-xs text-slate-500">{metric.what} · {metric.limit}</p>
      <p className="mt-2 text-xs">{changeText(metric.key, vital.change)}</p>
      {vital.good_share != null && (
        <p className="mt-1 text-xs text-slate-500">{vital.good_share}% of page loads good · {vital.poor_share}% poor</p>
      )}
    </div>
  );
}

function Cell({ v, k }: { v: Vital; k: (typeof METRICS)[number] }) {
  const r = v.rating ? RATING[v.rating] : null;
  return (
    <td className="py-2.5 pr-4 text-right">
      <span className={`inline-flex items-center gap-1.5 ${r ? r.text : "text-slate-400"}`}>
        {r && <span className={`h-2 w-2 rounded-full ${r.dot}`} />}
        {v.p75 == null ? "—" : k.fmt(v.p75)}
      </span>
    </td>
  );
}

function VitalsTable({ rows, label }: { rows: (VitalsRow & { name: string })[]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-slate-400">
            <th className="py-2 pr-4 font-medium">{label}</th>
            <th className="py-2 pr-4 text-right font-medium">Page loads</th>
            {METRICS.map((m) => <th key={m.key} className="py-2 pr-4 text-right font-medium">{m.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-slate-50 last:border-0">
              <td className="max-w-[320px] truncate py-2.5 pr-4 font-medium text-slate-800" title={r.name}>{r.name}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.page_loads.toLocaleString()}</td>
              {METRICS.map((m) => <Cell key={m.key} v={r[m.key]} k={m} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SiteHealth() {
  const [days, setDays] = useState<7 | 28>(28);
  const [data, setData] = useState<SiteHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.siteHealth(days)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load site health"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  const mobile = data?.devices?.Mobile;
  const desktop = data?.devices?.Desktop;
  const s = data?.search;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Main / Analytics</p>
          <h2 className="text-2xl font-bold text-slate-900">Site Health</h2>
          <p className="mt-1 text-sm text-slate-500">
            {data ? <>{data.window_label} · compared with {data.compare_label}</> : "Page speed and site search, from Shopify Analytics."}
          </p>
        </div>
        <div className="flex rounded-xl border bg-white p-1 text-sm">
          {([7, 28] as const).map((d) => (
            <button
              key={d}
              onClick={() => {
                if (d !== days) {
                  setLoading(true);
                  setDays(d);
                }
              }}
              className={`rounded-lg px-3 py-1.5 font-medium ${days === d ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && !data && <p className="text-sm text-slate-400">Loading from Shopify…</p>}

      {data && (
        <>
          <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Smartphone className="text-blue-500" size={20} />
              <h3 className="font-bold text-slate-900">Mobile page speed<InfoTip text={HELP.webVitals} /></h3>
            </div>
            {!data.cwv_available || !mobile ? (
              <p className="text-xs text-slate-400">Page speed data isn't available from Shopify for this period.</p>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  {METRICS.map((m) => <VitalTile key={m.key} metric={m} vital={mobile[m.key]} />)}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  p75 of {mobile.page_loads.toLocaleString()} mobile page loads: 75% of visits were at least this fast. Lower is better for all three.
                  {desktop && <> Desktop: LCP {desktop.lcp.p75 != null ? `${(desktop.lcp.p75 / 1000).toFixed(2)} s` : "—"} · INP {desktop.inp.p75 ?? "—"} ms · CLS {desktop.cls.p75 ?? "—"}.</>}
                </p>
              </>
            )}
            {data.trend.length > 1 && (
              <div className="mt-6">
                <p className="mb-2 text-xs font-medium text-slate-500">Mobile loading time (LCP p75) by day · dashed line = Google's 2.5 s limit</p>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.trend} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis unit=" s" tick={{ fill: "#94a3b8", fontSize: 11 }} domain={[0, "auto"]} />
                      <Tooltip formatter={(v) => [`${v} s`, "LCP p75"]} />
                      <ReferenceLine y={2.5} stroke="#10b981" strokeDasharray="4 4" />
                      <Line type="linear" dataKey="lcp_s" stroke="#2563eb" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </section>

          {data.page_types.length > 0 && (
            <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                <Gauge className="text-blue-500" size={20} />
                <h3 className="font-bold text-slate-900">Mobile speed by page type<InfoTip text={HELP.webVitals} /></h3>
              </div>
              <VitalsTable rows={data.page_types.map((p) => ({ ...p, name: p.label }))} label="Page type" />
              {data.pages.length > 0 && (
                <>
                  <p className="mb-2 mt-6 text-xs font-medium text-slate-500">Most-visited mobile pages</p>
                  <VitalsTable rows={data.pages.map((p) => ({ ...p, name: p.path === "/" ? "/ (homepage)" : p.path }))} label="Page" />
                </>
              )}
            </section>
          )}

          <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Search className="text-blue-500" size={20} />
              <h3 className="font-bold text-slate-900">Site search<InfoTip text={HELP.siteSearch} /></h3>
            </div>
            {!s ? (
              <p className="text-xs text-slate-400">Search data isn't available from Shopify for this period.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border p-4">
                    <p className="text-xs text-slate-500">Visits that searched</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{s.share_of_sessions == null ? "—" : `${s.share_of_sessions}%`}</p>
                    <p className="mt-1 text-xs text-slate-400">{s.sessions_with_searches.toLocaleString()} sessions</p>
                  </div>
                  <div className="rounded-xl border p-4">
                    <p className="text-xs text-slate-500">Conversion: searchers vs others</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {s.searcher_conversion_rate ?? "—"}%
                      <span className="ml-2 text-base font-semibold text-slate-400">vs {s.non_searcher_conversion_rate ?? "—"}%</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400">searchers · everyone else</p>
                  </div>
                  <div className="rounded-xl border p-4">
                    <p className="text-xs text-slate-500">Searchers who clicked a result</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{s.search_click_rate}%</p>
                    <p className="mt-1 text-xs text-slate-400">{s.search_added_to_cart_rate}% added to cart</p>
                  </div>
                  <div className={`rounded-xl border p-4 ${s.zero_result_share != null && s.zero_result_share >= 10 ? "border-red-200 bg-red-50" : ""}`}>
                    <p className="text-xs text-slate-500">Searches with no results</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{s.zero_result_share == null ? "—" : `${s.zero_result_share}%`}</p>
                    <p className="mt-1 text-xs text-slate-400">{s.zero_result_searches?.toLocaleString() ?? "—"} of {s.searches?.toLocaleString() ?? "—"} searches</p>
                  </div>
                </div>
                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-500">Top search terms</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-slate-400">
                          <th className="py-2 pr-4 font-medium">Term</th>
                          <th className="py-2 pr-4 text-right font-medium">Searches</th>
                          <th className="py-2 text-right font-medium">Clicked a result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.top_terms.map((t) => (
                          <tr key={t.term} className="border-b border-slate-50 last:border-0">
                            <td className="py-2 pr-4 text-slate-800">{t.term}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-slate-600">{t.searches.toLocaleString()}</td>
                            <td className="py-2 text-right text-slate-600">{t.click_rate == null ? "—" : `${t.click_rate}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-500">Top searches that found nothing · fix these first</p>
                    {s.zero_result_terms.length === 0 ? (
                      <p className="text-xs text-slate-400">No zero-result searches. 🎉</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-slate-400">
                            <th className="py-2 pr-4 font-medium">Term</th>
                            <th className="py-2 text-right font-medium">Searches</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.zero_result_terms.map((t) => (
                            <tr key={t.term} className="border-b border-slate-50 last:border-0">
                              <td className="py-2 pr-4 text-red-700">{t.term}</td>
                              <td className="py-2 text-right tabular-nums text-slate-600">{t.searches.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>

          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <Info size={15} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Not shown yet</p>
              {data.not_available.map((n) => <p key={n}>{n}</p>)}
            </div>
          </div>

          {Object.keys(data.errors).length > 0 && (
            <p className="text-xs text-slate-400">
              Some parts couldn't load from Shopify: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join("; ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default SiteHealth;
