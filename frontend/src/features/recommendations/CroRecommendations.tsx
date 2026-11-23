import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleCheck, CircleX, FlaskConical, Gauge, Lightbulb,
  ListChecks, Megaphone, Percent, ShoppingBag, Target, Wrench,
} from "lucide-react";
import type { ExperimentPrefill } from "../experiments/Experiments";
import {
  api, type RecAction, type RecFunnel, type RecRange, type RecStatus, type Recommendation, type Recommendations,
} from "../../services/api";

// CRO Recommendations v2 (deep dive). Each item is a full playbook built from
// the dashboard's own data: what's happening (numbers vs before / store /
// best segment / benchmark), likely causes, an action plan naming the pages,
// products or search terms, an A/B test plan with the sample size needed,
// and an estimated monthly impact with its formula. Ranked by
// impact x confidence / effort.

const RANGES: { key: RecRange; label: string }[] = [
  { key: "yesterday", label: "Yesterday" },
  { key: 7, label: "Last 7 days" },
  { key: 30, label: "Last 30 days" },
];

const ACTION: Record<RecAction, { label: string; chip: string; icon: typeof Wrench; bar: string }> = {
  fix: { label: "Fix", chip: "bg-rose-50 text-rose-700 border-rose-200", icon: Wrench, bar: "bg-rose-500" },
  promote: { label: "Promote", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Megaphone, bar: "bg-emerald-500" },
  test: { label: "Test", chip: "bg-violet-50 text-violet-700 border-violet-200", icon: FlaskConical, bar: "bg-violet-500" },
};

const LEVEL_STYLE: Record<string, string> = {
  Low: "bg-emerald-50 text-emerald-700",
  Medium: "bg-amber-50 text-amber-700",
  High: "bg-rose-50 text-rose-700",
};
const CONF_STYLE: Record<string, string> = {
  High: "bg-sky-50 text-sky-700",
  Medium: "bg-slate-100 text-slate-700",
  Low: "bg-slate-50 text-slate-500",
};

const STATUS: { key: RecStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
  { key: "ignored", label: "Ignore" },
];

type Filter = "all" | RecAction | "done_ignored";

const money = (v: number | null | undefined) =>
  v == null ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// A recommendation turned into an experiment plan (Experiments page form).
function toExperiment(rec: Recommendation): ExperimentPrefill {
  return {
    name: rec.title.slice(0, 120),
    hypothesis: rec.test?.hypothesis ?? "",
    metric: rec.test?.metric_key ?? (rec.kind === "landing_bounce" ? "bounce_rate" : "conversion_rate"),
    page_path: rec.page_path,
    rec_key: rec.key,
  };
}

function FunnelStrip({ funnel, compareLabel }: { funnel: RecFunnel; compareLabel: string }) {
  const rates: { key: string; label: string }[] = [
    { key: "cart", label: "Visit → Add to cart" },
    { key: "checkout", label: "Add to cart → Checkout" },
    { key: "purchase", label: "Checkout → Purchase" },
  ];
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Where you lose buyers</h2>
        <p className="text-xs text-slate-500">Step-to-step rate · vs {compareLabel}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {funnel.steps.map((s) => (
          <div key={s.key} className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-xl font-bold text-slate-900">{s.value.toLocaleString()}</p>
            <p className="text-xs text-slate-500">{s.pct_of_sessions != null ? `${s.pct_of_sessions}% of sessions` : ""}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {rates.map((r) => {
          const now = funnel.step_rates[r.key];
          const before = funnel.previous_step_rates[r.key];
          const diff = now != null && before != null ? now - before : null;
          const weakest = funnel.weakest_step === r.label;
          return (
            <div key={r.key} className={`rounded-xl border px-4 py-3 ${weakest ? "border-rose-300 bg-rose-50" : "border-slate-200"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-600">{r.label}</p>
                {weakest && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">BIGGEST LEAK</span>}
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900">{now != null ? `${now}%` : "—"}</p>
              {diff != null && (
                <p className={`text-xs font-semibold ${diff < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {diff > 0 ? "+" : ""}{diff.toFixed(2)} pts (was {before}%)
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecCard({ rec, maxImpact, onStatus, saving, onExperiment, top }: {
  rec: Recommendation;
  maxImpact: number;
  onStatus: (s: RecStatus) => void;
  saving: boolean;
  onExperiment?: () => void;
  top: boolean;
}) {
  const [open, setOpen] = useState(top);
  const a = ACTION[rec.action];
  const Icon = a.icon;
  const dim = rec.status === "done" || rec.status === "ignored";
  const width = maxImpact > 0 && rec.monthly_impact ? Math.max((rec.monthly_impact / maxImpact) * 100, 3) : 0;
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm transition sm:p-6 ${top ? "border-sky-300 ring-1 ring-sky-100" : "border-slate-200/80"} ${dim ? "opacity-60" : "hover:shadow-md"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${top ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            #{rec.rank}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${a.chip}`}>
                <Icon size={12} /> {a.label}
              </span>
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">{rec.area}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONF_STYLE[rec.confidence]}`}>{rec.confidence} confidence</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_STYLE[rec.effort]}`}>{rec.effort} effort</span>
              {top && <span className="rounded-full bg-sky-600 px-2.5 py-0.5 text-xs font-bold text-white">Do this first</span>}
            </div>
            <h3 className={`mt-2 break-words text-base font-bold text-slate-900 ${rec.status === "done" ? "line-through" : ""}`}>{rec.title}</h3>
            <p className="mt-0.5 break-words text-xs text-slate-500">{rec.segment} · see {rec.page}</p>
          </div>
        </div>
        <div className="shrink-0 text-left lg:text-right">
          <p className="text-xs text-slate-500">Est. extra sales / month</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900">{rec.monthly_impact ? money(rec.monthly_impact) : "Not estimated"}</p>
          <div className="mt-1.5 h-1.5 w-40 rounded-full bg-slate-100 lg:ml-auto">
            <div className={`h-full rounded-full ${a.bar}`} style={{ width: `${width}%` }} />
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-700">{rec.diagnosis}</p>

      {rec.metrics.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Metric</th>
                <th className="px-3 py-2 font-medium">Now</th>
                <th className="px-3 py-2 font-medium">Compared with</th>
                <th className="px-3 py-2 font-medium">Gap</th>
              </tr>
            </thead>
            <tbody>
              {rec.metrics.map((m) => (
                <tr key={m.label + m.value} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-600">{m.label}</td>
                  <td className={`px-3 py-2 font-semibold ${m.bad === true ? "text-rose-700" : m.bad === false ? "text-emerald-700" : "text-slate-900"}`}>{m.value}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {m.compare ? <>{m.compare} <span className="text-xs text-slate-400">{m.compare_label}</span></> : <span className="text-xs text-slate-400">{m.compare_label ?? ""}</span>}
                  </td>
                  <td className={`px-3 py-2 text-xs font-semibold ${m.bad ? "text-rose-600" : "text-slate-500"}`}>{m.gap ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900">
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Hide" : "Show"} causes, action plan and test
      </button>

      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-amber-50/60 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800"><AlertTriangle size={13} /> Likely causes</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {rec.causes.map((c) => (
                <li key={c} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-500" />{c}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-emerald-50/60 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800"><ListChecks size={13} /> Action plan</p>
            <ol className="mt-2 space-y-1.5 text-sm text-slate-700">
              {rec.steps.map((s, i) => (
                <li key={s} className="flex gap-2"><span className="shrink-0 font-bold text-emerald-700">{i + 1}.</span>{s}</li>
              ))}
            </ol>
          </div>
          {rec.test && (
            <div className="rounded-xl bg-violet-50/60 p-4 lg:col-span-2">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-800"><Target size={13} /> How to test it</p>
              <p className="mt-2 text-sm text-slate-700"><b>Hypothesis:</b> {rec.test.hypothesis}</p>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
                <span><b>Success metric:</b> {rec.test.metric}</span>
                <span><b>Target lift:</b> +{rec.test.target_lift_pct}%</span>
                {rec.test.sessions_per_variant != null && <span><b>Needs:</b> {rec.test.sessions_per_variant.toLocaleString()} per variant</span>}
                {rec.test.days_needed != null && <span><b>Duration:</b> ~{rec.test.days_needed} days at current traffic</span>}
              </div>
              {rec.test.note && <p className="mt-1.5 text-xs text-violet-700">{rec.test.note}</p>}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="text-xs text-slate-400">
          <p>Estimate: {rec.impact_formula}{rec.impact ? ` = ${money(rec.impact)} in ${rec.window_label}` : ""}</p>
          {rec.assumption && <p className="mt-0.5">{rec.assumption}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onExperiment && (
            <button
              onClick={onExperiment}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100"
            >
              <FlaskConical size={13} /> Start experiment
            </button>
          )}
          <div className="flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs">
            {STATUS.map((s) => (
              <button
                key={s.key}
                disabled={saving}
                onClick={() => s.key !== rec.status && onStatus(s.key)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 font-semibold transition disabled:opacity-60 ${
                  rec.status === s.key ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CroRecommendations({ onExperiment }: { onExperiment?: (p: ExperimentPrefill) => void }) {
  const [range, setRange] = useState<RecRange>(30);
  const [data, setData] = useState<Recommendations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [area, setArea] = useState<string>("all");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .recommendations(range)
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load recommendations"));
    return () => {
      alive = false;
    };
  }, [range]);

  const recs = useMemo(() => data?.recommendations ?? [], [data]);
  const active = recs.filter((r) => r.status !== "done" && r.status !== "ignored");
  const topKeys = new Set(active.slice(0, 3).map((r) => r.key));
  const shown = useMemo(() => {
    let base = filter === "done_ignored"
      ? recs.filter((r) => r.status === "done" || r.status === "ignored")
      : recs.filter((r) => r.status !== "done" && r.status !== "ignored");
    if (filter !== "all" && filter !== "done_ignored") base = base.filter((r) => r.action === filter);
    if (area !== "all") base = base.filter((r) => r.area === area);
    return base;
  }, [recs, filter, area]);
  const maxImpact = Math.max(0, ...recs.map((r) => r.monthly_impact ?? 0));
  const count = (a: RecAction) => active.filter((r) => r.action === a).length;

  const setStatus = (rec: Recommendation, status: RecStatus) => {
    setSaving(rec.key);
    api
      .setRecommendationStatus(rec.key, status)
      .then(() =>
        setData((d) => d && { ...d, recommendations: d.recommendations.map((r) => (r.key === rec.key ? { ...r, status } : r)) }),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't save the status"))
      .finally(() => setSaving(null));
  };

  const top5 = active.slice(0, 5).reduce((s, r) => s + (r.monthly_impact ?? 0), 0);
  const cvr = data?.store_conversion_rate;
  const tiles = [
    { label: "Open items", value: data ? String(active.length) : "…", sub: data ? `${count("fix")} fix · ${count("promote")} promote · ${count("test")} test` : "", icon: ListChecks, cls: "kpi-blue" },
    { label: "Top 5 opportunity / month", value: data ? money(top5) : "…", sub: "estimate; items overlap, so not summed", icon: Lightbulb, cls: "kpi-teal" },
    { label: "Store conversion", value: cvr != null ? `${cvr}%` : "…", sub: data ? `industry avg ~${data.industry_conversion_rate}% · ${data.sessions.toLocaleString()} sessions` : "", icon: Percent, cls: "kpi-indigo" },
    { label: "Average order value", value: data ? money(data.aov) : "…", sub: data ? `${data.orders.toLocaleString()} orders` : "", icon: ShoppingBag, cls: "kpi-amber" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Recommendations</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? <>Based on <b className="text-sky-700">{data.window_label}</b> · ranked by impact × confidence ÷ effort</> : "Loading…"}
          </p>
        </div>
        <div className="flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => r.key !== range && setRange(r.key)}
              className={`rounded-lg px-3 py-1.5 font-medium ${range === r.key ? "bg-sky-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={`kpi-tile ${t.cls} rounded-2xl p-5 shadow-sm`}>
            <div className="relative flex items-center justify-between">
              <p className="text-sm font-medium text-white/90">{t.label}</p>
              <div className="rounded-xl bg-white/20 p-2 text-white"><t.icon size={18} /></div>
            </div>
            <p className="relative mt-3 text-3xl font-semibold tracking-tight text-white">{t.value}</p>
            <p className="relative mt-1 truncate text-xs text-white/80">{t.sub}</p>
          </div>
        ))}
      </div>

      {data?.funnel && <FunnelStrip funnel={data.funnel} compareLabel={data.compare_label} />}

      {data && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-500">Data checked:</span>
          {data.coverage.map((c) => (
            <span key={c.source} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${c.ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
              {c.ok ? <CircleCheck size={12} /> : <CircleX size={12} />} {c.source}
            </span>
          ))}
        </div>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {data && data.errors.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Some data couldn't be loaded, so a few items may be missing: {data.errors.join(" · ")}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {([
          { key: "all", label: `All open (${active.length})` },
          { key: "fix", label: `Fix (${count("fix")})` },
          { key: "promote", label: `Promote (${count("promote")})` },
          { key: "test", label: `Test (${count("test")})` },
          { key: "done_ignored", label: `Done / ignored (${recs.length - active.length})` },
        ] as { key: Filter; label: string }[]).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3.5 py-1.5 font-medium transition ${
              filter === f.key ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
        {data && data.areas.length > 1 && (
          <select
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 font-medium text-slate-600"
          >
            <option value="all">All areas</option>
            {data.areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>

      {!data && !error && (
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          <Gauge size={18} className="animate-pulse text-sky-500" /> Checking funnel, pages, products, speed, search and orders…
        </div>
      )}

      {data && shown.length === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          <CheckCircle2 size={20} className="text-emerald-500" />
          {filter === "done_ignored" ? "Nothing marked done or ignored yet." : "Nothing flagged for these dates."}
        </div>
      )}

      <div className="space-y-4">
        {shown.map((rec) => (
          <RecCard
            key={rec.key}
            rec={rec}
            top={topKeys.has(rec.key)}
            maxImpact={maxImpact}
            saving={saving === rec.key}
            onStatus={(s) => setStatus(rec, s)}
            onExperiment={onExperiment ? () => onExperiment(toExperiment(rec)) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export default CroRecommendations;
