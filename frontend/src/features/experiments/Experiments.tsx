import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, FlaskConical, Pencil, Plus, Timer, Trash2, Trophy, XCircle } from "lucide-react";
import { api, type Experiment, type ExperimentInput, type ExperimentMetric, type ExperimentResult } from "../../services/api";

// Experiment log (manager checklist, section 8, P3): hypothesis, start and end
// dates, metric, result, confidence. The team saves the plan; the result and
// confidence come from Shopify (before vs during, bots excluded).

export type ExperimentPrefill = Partial<ExperimentInput> | null;

const METRICS: { key: ExperimentMetric; label: string }[] = [
  { key: "conversion_rate", label: "Conversion rate" },
  { key: "added_to_cart_rate", label: "Add-to-cart rate" },
  { key: "bounce_rate", label: "Bounce rate" },
  { key: "aov", label: "Average order value" },
];

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short" });

const EMPTY: ExperimentInput = {
  name: "", hypothesis: "", metric: "conversion_rate", start_date: today(), end_date: null, page_path: null, owner: null, rec_key: null,
};

const VERDICT: Record<string, { label: string; cls: string; icon: typeof Trophy }> = {
  win: { label: "Win", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Trophy },
  better: { label: "Better", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  loss: { label: "Loss", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: XCircle },
  worse: { label: "Worse", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: XCircle },
  running: { label: "Running", cls: "bg-sky-50 text-sky-700 border-sky-200", icon: Timer },
  early: { label: "Running", cls: "bg-sky-50 text-sky-700 border-sky-200", icon: Timer },
  no_clear_result: { label: "No clear result", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: CircleDashed },
  flat: { label: "No change", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: CircleDashed },
  too_few: { label: "Too few visits", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: CircleDashed },
  not_started: { label: "Planned", cls: "bg-violet-50 text-violet-700 border-violet-200", icon: CircleDashed },
  no_data: { label: "No data", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: CircleDashed },
  error: { label: "Couldn't load", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: XCircle },
};

function verdictFor(r: ExperimentResult) {
  // A win / loss while it's still running is "so far".
  const v = VERDICT[r.verdict] ?? VERDICT.no_data;
  if (r.state === "running" && (r.verdict === "win" || r.verdict === "loss")) return { ...v, label: `${v.label} so far` };
  return v;
}

function value(v: number | null | undefined, unit: string | undefined) {
  if (v == null) return "—";
  return unit === "orders" ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${v}%`;
}

function ExperimentCard({ exp, onEdit, onDelete }: { exp: Experiment; onEdit: () => void; onDelete: () => void }) {
  const r = exp.result;
  const v = verdictFor(r);
  const VIcon = v.icon;
  const changeGood = r.change != null && r.change !== 0 ? (r.change > 0) === (exp.better === "up") : null;
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${v.cls}`}>
              <VIcon size={12} /> {v.label}
            </span>
            <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">{exp.metric_label}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{exp.page_path || "Whole store"}</span>
          </div>
          <h3 className="mt-2 break-words text-base font-bold text-slate-900">{exp.name}</h3>
          <p className="mt-1 break-words text-sm text-slate-600">{exp.hypothesis}</p>
          <p className="mt-1 text-xs text-slate-500">
            {fmtDate(exp.start_date)} → {exp.end_date ? fmtDate(exp.end_date) : "running"}{exp.owner ? ` · ${exp.owner}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onEdit} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700" aria-label="Edit"><Pencil size={16} /></button>
          <button onClick={onDelete} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete"><Trash2 size={16} /></button>
        </div>
      </div>

      {r.state !== "planned" && r.state !== "error" && (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Before · {r.before_label}</p>
            <p className="mt-1 text-lg font-bold text-slate-800">{value(r.before, r.n_unit)}</p>
            <p className="text-xs text-slate-500">{r.before_n?.toLocaleString()} {r.n_unit}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">During · {r.during_label}</p>
            <p className="mt-1 text-lg font-bold text-slate-800">{value(r.during, r.n_unit)}</p>
            <p className="text-xs text-slate-500">{r.during_n?.toLocaleString()} {r.n_unit}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Change</p>
            <p className={`mt-1 text-lg font-bold ${changeGood == null ? "text-slate-800" : changeGood ? "text-emerald-600" : "text-rose-600"}`}>
              {r.change == null ? "—" : `${r.change > 0 ? "+" : ""}${r.change} ${r.change_unit}`}
            </p>
            <p className="text-xs text-slate-500">{exp.better === "up" ? "higher is better" : "lower is better"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Confidence</p>
            <p className="mt-1 text-lg font-bold text-slate-800">{r.confidence == null ? "—" : `${r.confidence}%`}</p>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full ${(r.confidence ?? 0) >= 95 ? "bg-emerald-500" : "bg-sky-400"}`}
                style={{ width: `${Math.min(r.confidence ?? 0, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}
      {r.state === "error" && <p className="mt-3 text-xs text-rose-600">{r.error}</p>}
    </div>
  );
}

function ExperimentForm({ initial, editingId, onSaved, onCancel }: {
  initial: ExperimentInput;
  editingId: number | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<ExperimentInput>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof ExperimentInput>(k: K, v: ExperimentInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400";

  const save = () => {
    setSaving(true);
    setErr(null);
    api
      .saveExperiment(f, editingId ?? undefined)
      .then(onSaved)
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't save"))
      .finally(() => setSaving(false));
  };

  return (
    <div className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="mb-4 font-bold text-slate-900">{editingId ? "Edit experiment" : "New experiment"}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-slate-500">
          Name
          <input className={input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Sticky add-to-cart on mobile" />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-500">
          Metric
          <select className={input} value={f.metric} onChange={(e) => set("metric", e.target.value as ExperimentMetric)}>
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-500 md:col-span-2">
          Hypothesis
          <textarea
            className={`${input} min-h-[70px]`}
            value={f.hypothesis}
            onChange={(e) => set("hypothesis", e.target.value)}
            placeholder="If we show the add-to-cart button while scrolling on mobile, more mobile visitors will buy"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-500">
          Start date
          <input type="date" className={input} value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-500">
          End date (empty = still running)
          <input type="date" className={input} value={f.end_date ?? ""} onChange={(e) => set("end_date", e.target.value || null)} />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-500">
          Landing page (empty = whole store)
          <input className={input} value={f.page_path ?? ""} onChange={(e) => set("page_path", e.target.value || null)} placeholder="/products/sage-green-stripe-quilt" disabled={f.metric === "aov"} />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-500">
          Owner
          <input className={input} value={f.owner ?? ""} onChange={(e) => set("owner", e.target.value || null)} />
        </label>
      </div>
      {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={saving || !f.name.trim() || !f.hypothesis.trim() || !f.start_date}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save experiment"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </div>
  );
}

function Experiments({ prefill, onPrefillUsed }: { prefill?: ExperimentPrefill; onPrefillUsed?: () => void }) {
  const [list, setList] = useState<Experiment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ initial: ExperimentInput; id: number | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (prefill) {
      setForm({ initial: { ...EMPTY, ...prefill }, id: null });
      onPrefillUsed?.();
    }
  }, [prefill, onPrefillUsed]);

  useEffect(() => {
    let alive = true;
    api
      .experiments()
      .then((r) => alive && setList(r.experiments))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load experiments"));
    return () => {
      alive = false;
    };
  }, [reload]);

  const remove = (exp: Experiment) => {
    if (!window.confirm(`Delete "${exp.name}"?`)) return;
    api.deleteExperiment(exp.id).then(() => setReload((n) => n + 1)).catch((e) => setError(e instanceof Error ? e.message : "Couldn't delete"));
  };

  const all = list ?? [];
  const running = all.filter((e) => e.result.state === "running").length;
  const finished = all.filter((e) => e.result.state === "finished");
  const wins = finished.filter((e) => e.result.verdict === "win" || e.result.verdict === "better").length;
  const tiles = [
    { label: "Experiments", value: list ? String(all.length) : "…", sub: list ? `${all.filter((e) => e.result.state === "planned").length} planned` : "", cls: "kpi-blue" },
    { label: "Running now", value: list ? String(running) : "…", sub: "measured up to yesterday", cls: "kpi-teal" },
    { label: "Finished", value: list ? String(finished.length) : "…", sub: list ? `${wins} won` : "", cls: "kpi-indigo" },
    { label: "Win rate", value: list ? (finished.length ? `${Math.round((wins / finished.length) * 100)}%` : "—") : "…", sub: "of finished tests", cls: "kpi-amber" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Experiments</h1>
          <p className="mt-1 text-sm text-slate-500">Each test compared with the same number of days before it started, from Shopify</p>
        </div>
        {!form && (
          <button
            onClick={() => setForm({ initial: { ...EMPTY, start_date: today() }, id: null })}
            className="flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700"
          >
            <Plus size={16} /> New experiment
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={`kpi-tile ${t.cls} rounded-2xl p-5 shadow-sm`}>
            <div className="relative flex items-center justify-between">
              <p className="text-sm font-medium text-white/90">{t.label}</p>
              <div className="rounded-xl bg-white/20 p-2 text-white"><FlaskConical size={18} /></div>
            </div>
            <p className="relative mt-3 text-3xl font-semibold tracking-tight text-white">{t.value}</p>
            <p className="relative mt-1 truncate text-xs text-white/80">{t.sub}</p>
          </div>
        ))}
      </div>

      {form && (
        <ExperimentForm
          key={`${form.id ?? "new"}-${form.initial.rec_key ?? ""}`}
          initial={form.initial}
          editingId={form.id}
          onCancel={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setReload((n) => n + 1);
          }}
        />
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!list && !error && <p className="text-sm text-slate-400">Loading experiments and their results from Shopify…</p>}
      {list && all.length === 0 && !form && (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          No experiments yet. Start one here, or from a "Test" item on the Recommendations page.
        </div>
      )}

      <div className="space-y-4">
        {all.map((exp) => (
          <ExperimentCard
            key={exp.id}
            exp={exp}
            onDelete={() => remove(exp)}
            onEdit={() =>
              setForm({
                id: exp.id,
                initial: {
                  name: exp.name, hypothesis: exp.hypothesis, metric: exp.metric, start_date: exp.start_date,
                  end_date: exp.end_date, page_path: exp.page_path, owner: exp.owner, rec_key: exp.rec_key,
                },
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

export default Experiments;
