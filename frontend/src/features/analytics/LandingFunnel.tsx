import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Filter, Search } from "lucide-react";
import { api, type LandingFunnelData, type LandingFunnelRow, type LandingFunnelStep } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { Delta, pagePathLabel } from "./landingDelta";

// Funnel by landing page: for every page, how many of its visitors viewed a
// product, added to cart, reached checkout and bought - this week vs last week
// or last 30 days vs the 30 before. Click a page for its deep dive.

type Mode = "wow" | "mom";
type SortKey = "sessions" | "purchase" | "purchase_drop" | "cart_drop" | "checkout_leak";

const HELP_TEXT =
  "Each cell = share of the page's sessions that reached that step (big number) and the change vs the previous period. " +
  "The small grey number is the step % (share of the step before that moved on). " +
  "Week on week = last 7 complete days vs the 7 before; month on month = last 30 vs the 30 before. Click a page for its full deep dive.";

const stepOf = (r: LandingFunnelRow, w: keyof LandingFunnelRow, k: LandingFunnelStep["key"]) =>
  (r[w] as LandingFunnelRow["week"]).steps.find((s) => s.key === k);

function LandingFunnel({ onOpen, end = null }: { onOpen: (path: string) => void; end?: string | null }) {
  const [data, setData] = useState<LandingFunnelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("wow");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("sessions");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    api.landingFunnel(end)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load the funnel"));
    return () => {
      alive = false;
    };
  }, [end]);

  const cur = mode === "wow" ? "week" : "month";
  const prev = mode === "wow" ? "prev_week" : "prev_month";
  const enoughKey = mode === "wow" ? "week_enough" : "month_enough";
  const steps = (data?.steps ?? []).filter((s) => s.key !== "sessions");

  const rows = useMemo(() => {
    let list = (data?.pages ?? []).filter((p) => p[cur].sessions > 0 || p[prev].sessions > 0);
    if (search.trim()) list = list.filter((p) => p.path.includes(search.trim().toLowerCase()));
    const score = (p: LandingFunnelRow): number | null => {
      const get = (w: typeof cur | typeof prev, k: LandingFunnelStep["key"], f: "pct_of_sessions" | "pct_of_previous" = "pct_of_sessions") =>
        stepOf(p, w, k)?.[f] ?? null;
      switch (sort) {
        case "sessions": return p[cur].sessions;
        case "purchase": return p[enoughKey] ? get(cur, "completed_checkout") : null;
        case "purchase_drop": {
          const a = get(cur, "completed_checkout"), b = get(prev, "completed_checkout");
          return p[enoughKey] && a != null && b != null ? b - a : null;
        }
        case "cart_drop": {
          const a = get(cur, "added_to_cart"), b = get(prev, "added_to_cart");
          return p[enoughKey] && a != null && b != null ? b - a : null;
        }
        case "checkout_leak": {
          const a = get(cur, "completed_checkout", "pct_of_previous");
          return p[enoughKey] && a != null ? 100 - a : null;
        }
      }
    };
    return [...list].sort((a, b) => (score(b) ?? -Infinity) - (score(a) ?? -Infinity));
  }, [data, cur, prev, enoughKey, search, sort]);

  const visible = showAll ? rows : rows.slice(0, 20);

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Filter className="text-blue-500" size={20} />
          <div>
            <h3 className="font-bold text-slate-900">Funnel by landing page<InfoTip text={HELP_TEXT} /></h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {data ? `${data.windows[cur].label} vs ${data.windows[prev].label}` : "Loading from Shopify…"} · sessions → product view → cart → checkout → purchase
            </p>
          </div>
        </div>
        <div className="flex rounded-xl border bg-white p-1 text-sm">
          {(["wow", "mom"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 font-medium ${mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {m === "wow" ? "Week on week" : "Month on month"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!data && !error && <p className="text-sm text-slate-400">Loading funnel…</p>}

      {data && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search page" className="w-44 rounded-lg border py-1.5 pl-8 pr-2 text-sm outline-none focus:border-blue-300" />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border px-2 py-1.5 text-sm">
              <option value="sessions">Sort: Sessions</option>
              <option value="purchase">Sort: Best purchase rate</option>
              <option value="purchase_drop">Sort: Biggest purchase-rate drop</option>
              <option value="cart_drop">Sort: Biggest add-to-cart drop</option>
              <option value="checkout_leak">Sort: Most checkout abandonment</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Page</th>
                  <th className="pb-3 pr-4 text-right font-medium">Sessions</th>
                  {steps.map((s) => <th key={s.key} className="pb-3 pr-4 text-right font-medium">{s.label}</th>)}
                  <th className="pb-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.path} onClick={() => onOpen(p.path)} className="cursor-pointer border-b last:border-0 hover:bg-slate-50">
                    <td className="max-w-[280px] py-3 pr-4">
                      <span className="block truncate font-medium text-slate-800" title={p.path}>{pagePathLabel(p.path)}</span>
                      <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{p.page_type}</span>
                    </td>
                    <td className="py-3 pr-4 text-right align-top">
                      <div className="tabular-nums text-slate-800">{p[cur].sessions.toLocaleString()}</div>
                      <Delta cur={p[cur].sessions} prev={p[prev].sessions} kind="count" />
                    </td>
                    {steps.map((s) => {
                      const c = stepOf(p, cur, s.key), v = stepOf(p, prev, s.key);
                      return (
                        <td key={s.key} className="py-3 pr-4 text-right align-top">
                          <div className="tabular-nums text-slate-800">{c?.pct_of_sessions == null ? "—" : `${c.pct_of_sessions}%`}</div>
                          <Delta cur={c?.pct_of_sessions} prev={v?.pct_of_sessions} kind="rate" enough={p[enoughKey]} />
                          <div className="text-[10px] text-slate-400" title="Share of the step before that moved on">
                            {c?.count.toLocaleString()} · step {c?.pct_of_previous == null ? "—" : `${c.pct_of_previous}%`}
                          </div>
                        </td>
                      );
                    })}
                    <td className="py-3 text-right">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-blue-600">Deep dive <ArrowRight size={12} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 20 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-4 text-sm font-semibold text-blue-600 hover:underline">
              {showAll ? "Show top 20" : `Show all ${rows.length} pages`}
            </button>
          )}
          {!data.product_views_available && <p className="mt-2 text-xs text-slate-400">Product view step isn't available from Shopify for this store, so it's left out.</p>}
          {Object.keys(data.errors).length > 0 && (
            <p className="mt-2 text-xs text-slate-400">Some parts couldn't load from Shopify: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join("; ")}</p>
          )}
        </>
      )}
    </section>
  );
}

export default LandingFunnel;
