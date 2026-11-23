import { useState } from "react";
import { Filter } from "lucide-react";
import type { LandingFunnelView, LandingWindowName, LandingWindowsMeta } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import { Delta } from "./landingDelta";

// Inside the deep dive: this page's funnel, step by step, this period vs the
// one before (WoW or MoM). Highlights the step that lost the most.

type Mode = "wow" | "mom";

const HELP =
  "Visits that landed on this page and then: viewed a product, added to cart, reached checkout, and purchased. " +
  "'% of sessions' = share of all visits that got that far. 'Step %' = share of the step before that moved on (the drop-off shows how many were lost). " +
  "The red step is the one whose step % fell the most vs the previous period.";

function LandingFunnelSteps({ funnel, windows, minWeek, minMonth }: {
  funnel: { product_views_available: boolean } & Record<LandingWindowName, LandingFunnelView>;
  windows: LandingWindowsMeta;
  minWeek: number;
  minMonth: number;
}) {
  const [mode, setMode] = useState<Mode>("wow");
  const cur: LandingWindowName = mode === "wow" ? "week" : "month";
  const prev: LandingWindowName = mode === "wow" ? "prev_week" : "prev_month";
  const c = funnel[cur], p = funnel[prev];
  const min = mode === "wow" ? minWeek : minMonth;
  const enough = c.sessions >= min && p.sessions >= min;

  // the step whose step-conversion fell the most
  let worst: string | null = null;
  if (enough) {
    let worstDrop = -1;
    c.steps.forEach((s, i) => {
      const ps = p.steps[i];
      if (i === 0 || s.pct_of_previous == null || ps?.pct_of_previous == null) return;
      const drop = ps.pct_of_previous - s.pct_of_previous;
      if (drop > worstDrop && drop >= 2) {
        worstDrop = drop;
        worst = s.key;
      }
    });
  }

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Filter className="text-blue-500" size={18} />
          <h4 className="font-bold text-slate-900">Funnel for this page<InfoTip text={HELP} /></h4>
        </div>
        <div className="flex rounded-lg border bg-white p-0.5 text-xs">
          {(["wow", "mom"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 font-medium ${mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {m === "wow" ? "WoW" : "MoM"}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-400">{windows[cur].label} vs {windows[prev].label}{!enough && " · too few sessions to judge changes"}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-400">
              <th className="py-2 pr-3 font-medium">Step</th>
              <th className="w-[34%] py-2 pr-3 font-medium" />
              <th className="py-2 pr-3 text-right font-medium">Count</th>
              <th className="py-2 pr-3 text-right font-medium">% of sessions</th>
              <th className="py-2 pr-3 text-right font-medium">Step %</th>
              <th className="py-2 text-right font-medium">Dropped</th>
            </tr>
          </thead>
          <tbody>
            {c.steps.map((s, i) => {
              const ps = p.steps[i];
              const before = i > 0 ? c.steps[i - 1].count : null;
              const bad = worst === s.key;
              const width = s.pct_of_sessions == null ? 0 : Math.max(s.pct_of_sessions, s.count ? 1.5 : 0);
              const prevWidth = ps?.pct_of_sessions == null ? 0 : Math.max(ps.pct_of_sessions, ps.count ? 1.5 : 0);
              return (
                <tr key={s.key} className={`border-b border-slate-50 last:border-0 ${bad ? "bg-red-50/60" : ""}`}>
                  <td className="py-2 pr-3 font-medium text-slate-700">
                    {s.label}
                    {bad && <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">biggest leak</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="space-y-1">
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.min(width, 100)}%` }} /></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-300" style={{ width: `${Math.min(prevWidth, 100)}%` }} /></div>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="tabular-nums text-slate-800">{s.count.toLocaleString()}</div>
                    <Delta cur={s.count} prev={ps?.count} kind="count" />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="tabular-nums text-slate-800">{s.pct_of_sessions == null ? "—" : `${s.pct_of_sessions}%`}</div>
                    {i > 0 && <Delta cur={s.pct_of_sessions} prev={ps?.pct_of_sessions} kind="rate" enough={enough} />}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="tabular-nums text-slate-800">{s.pct_of_previous == null ? "—" : `${s.pct_of_previous}%`}</div>
                    {i > 0 && <Delta cur={s.pct_of_previous} prev={ps?.pct_of_previous} kind="rate" enough={enough} />}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">{before != null ? (before - s.count).toLocaleString() : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Thick blue bar = {windows[cur].label}; thin grey bar = {windows[prev].label}.{!funnel.product_views_available && " Product view step isn't available from Shopify for this store."}</p>
    </section>
  );
}

export default LandingFunnelSteps;
