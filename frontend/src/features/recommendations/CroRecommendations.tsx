import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, Gauge, Lightbulb, ListChecks, Megaphone, Percent, ShoppingBag, Wrench } from "lucide-react";
import type { ExperimentPrefill } from "../experiments/Experiments";
import { api, type RecAction, type RecRange, type RecStatus, type Recommendation, type Recommendations } from "../../services/api";

// Section 8 of the manager's checklist: one list, ranked by estimated impact
// (sessions x conversion gap x AOV), pulled from every page of the dashboard.
// Each item ends in an action (fix / promote / test) and has a saved status.

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

const EFFORT_STYLE: Record<string, string> = {
  Low: "bg-emerald-50 text-emerald-700",
  Medium: "bg-amber-50 text-amber-700",
  High: "bg-rose-50 text-rose-700",
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
  const page = rec.key.startsWith("landing_") ? rec.key.slice(rec.key.indexOf(":") + 1) : null;
  return {
    name: rec.title.slice(0, 120),
    hypothesis: "",
    metric: rec.kind === "landing_bounce" ? "bounce_rate" : "conversion_rate",
    page_path: page,
    rec_key: rec.key,
  };
}

function RecCard({ rec, maxImpact, onStatus, saving, onExperiment }: {
  rec: Recommendation;
  maxImpact: number;
  onStatus: (s: RecStatus) => void;
  saving: boolean;
  onExperiment?: () => void;
}) {
  const a = ACTION[rec.action];
  const Icon = a.icon;
  const dim = rec.status === "done" || rec.status === "ignored";
  const width = maxImpact > 0 && rec.impact ? Math.max((rec.impact / maxImpact) * 100, 3) : 0;
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition sm:p-6 ${dim ? "opacity-60" : "hover:shadow-md"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
            #{rec.rank}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${a.chip}`}>
                <Icon size={12} /> {a.label}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${EFFORT_STYLE[rec.effort]}`}>{rec.effort} effort</span>
              <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">{rec.page}</span>
            </div>
            <h3 className={`mt-2 break-words text-base font-bold text-slate-900 ${rec.status === "done" ? "line-through" : ""}`}>{rec.title}</h3>
            <p className="mt-0.5 break-words text-xs text-slate-500">{rec.segment}</p>
          </div>
        </div>
        <div className="shrink-0 text-left lg:text-right">
          <p className="text-xs text-slate-500">Est. impact</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900">{money(rec.impact)}</p>
          <div className="mt-1.5 h-1.5 w-40 rounded-full bg-slate-100 lg:ml-auto">
            <div className={`h-full rounded-full ${a.bar}`} style={{ width: `${width}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <ul className="space-y-1 text-sm text-slate-600">
            {rec.evidence.map((e) => (
              <li key={e} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />{e}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">{rec.impact_formula}</p>
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

  const recs = data?.recommendations ?? [];
  const active = recs.filter((r) => r.status !== "done" && r.status !== "ignored");
  const shown = useMemo(() => {
    if (filter === "done_ignored") return recs.filter((r) => r.status === "done" || r.status === "ignored");
    const base = recs.filter((r) => r.status !== "done" && r.status !== "ignored");
    return filter === "all" ? base : base.filter((r) => r.action === filter);
  }, [recs, filter]);
  const maxImpact = Math.max(0, ...recs.map((r) => r.impact ?? 0));
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

  const tiles = [
    { label: "Open items", value: data ? String(active.length) : "…", sub: data ? `${count("fix")} fix · ${count("promote")} promote · ${count("test")} test` : "", icon: ListChecks, cls: "kpi-blue" },
    { label: "Biggest opportunity", value: data ? money(active[0]?.impact ?? null) : "…", sub: active[0]?.segment ?? "", icon: Lightbulb, cls: "kpi-teal" },
    { label: "Store conversion", value: data?.store_conversion_rate != null ? `${data.store_conversion_rate}%` : "…", sub: data ? `${data.sessions.toLocaleString()} sessions` : "", icon: Percent, cls: "kpi-indigo" },
    { label: "Average order value", value: data ? money(data.aov) : "…", sub: data ? `${data.orders.toLocaleString()} orders` : "", icon: ShoppingBag, cls: "kpi-amber" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Recommendations</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? <>Based on <b className="text-sky-700">{data.window_label}</b> · ranked by estimated impact</> : "Loading…"}
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
      </div>

      {!data && !error && (
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          <Gauge size={18} className="animate-pulse text-sky-500" /> Checking every page against Shopify…
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
