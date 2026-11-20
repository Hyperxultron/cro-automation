import { useCallback, useEffect, useState } from "react";
import { Clock3, Mail, RefreshCw, ShoppingBag, TrendingDown } from "lucide-react";
import { api, timeAgo, type AlarmRuleItem } from "../../services/api";

const iconFor = (title: string) => (title.toLowerCase().includes("quilt") ? ShoppingBag : TrendingDown);

type Tone = "ok" | "alert" | "muted";
const statusLabel: Record<string, { text: string; tone: Tone }> = {
  normal: { text: "All good", tone: "ok" },
  alarm_triggered: { text: "Alert sent", tone: "alert" },
  alarm_active: { text: "Alerting", tone: "alert" },
  no_quilt_orders_yet: { text: "No quilt orders yet", tone: "muted" },
  no_quilt_products: { text: "No quilt products mapped", tone: "muted" },
  no_active_rule: { text: "Paused", tone: "muted" },
  insufficient_data: { text: "Not enough data", tone: "muted" },
  rule_inactive: { text: "Paused", tone: "muted" },
  error: { text: "Check failed", tone: "muted" },
};

const pill: Record<Tone, string> = {
  alert: "bg-red-50 text-red-700 ring-red-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  muted: "bg-slate-100 text-slate-500 ring-slate-200",
};

const thresholdText = (rule: AlarmRuleItem) => {
  if (rule.threshold == null) return null;
  return rule.title.toLowerCase().includes("quilt")
    ? `Limit: ${rule.threshold}h without a quilt order`
    : `Limit: ${rule.threshold}% below average`;
};

function AlarmRules() {
  const [rules, setRules] = useState<AlarmRuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .alarmRules()
      .then(setRules)
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load alarm rules"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (rule: AlarmRuleItem) => {
    setBusyId(rule.id);
    try {
      await api.updateAlarmRule(rule.id, { is_active: !rule.is_active });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update rule");
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = rules.filter((r) => r.is_active).length;
  const alertingCount = rules.filter((r) => r.is_active && statusLabel[r.live_status ?? ""]?.tone === "alert").length;

  const stats = [
    { label: "Rules", value: rules.length },
    { label: "Active", value: activeCount },
    { label: "Alerting now", value: alertingCount, alert: alertingCount > 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Automation / Monitoring</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Alarm Rules</h1>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Check now
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.alert ? "text-red-600" : "text-slate-900"}`}>
              {loading && !rules.length ? "…" : s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {!loading && rules.length === 0 && (
          <p className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
            No alarm rules yet. They are created the first time each check runs.
          </p>
        )}

        {rules.map((rule) => {
          const Icon = iconFor(rule.title);
          const live = rule.is_active
            ? (rule.live_status ? statusLabel[rule.live_status] : null)
            : statusLabel.rule_inactive;
          const limit = thresholdText(rule);

          return (
            <div
              key={rule.id}
              className={`rounded-2xl border bg-white p-5 shadow-sm sm:p-6 ${live?.tone === "alert" ? "border-red-200" : "border-slate-200/80"}`}
            >
              <div className="flex items-start gap-4">
                <div className={`rounded-xl p-3 ${live?.tone === "alert" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                  <Icon size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 sm:text-lg">{rule.title}</h3>
                    {live && (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${pill[live.tone]}`}>{live.text}</span>
                    )}
                  </div>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{rule.description ?? "—"}</p>
                  {rule.is_active && rule.live_detail && (
                    <p className={`mt-3 rounded-xl px-3 py-2 text-sm font-medium ${live?.tone === "alert" ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"}`}>
                      {rule.live_detail}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => toggle(rule)}
                  disabled={busyId === rule.id}
                  aria-label={`Toggle ${rule.title}`}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${rule.is_active ? "bg-blue-600" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${rule.is_active ? "left-6" : "left-1"}`} />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600 sm:pl-[62px]">
                <span className="inline-flex items-center gap-2">
                  <Clock3 size={16} className="text-slate-400" />
                  Checked {timeAgo(rule.last_checked_at)}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Mail size={16} className="text-slate-400" />
                  Last alert {rule.last_triggered_at ? timeAgo(rule.last_triggered_at) : "never"}
                </span>
                {limit && <span className="text-slate-500">{limit}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AlarmRules;
