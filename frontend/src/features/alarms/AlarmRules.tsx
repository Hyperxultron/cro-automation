import { useCallback, useEffect, useState } from "react";
import { Bell, Clock3, Mail, ShieldCheck, ShoppingBag, TrendingDown } from "lucide-react";
import { api, timeAgo, type AlarmRuleItem } from "../../services/api";

const iconFor = (title: string) => (title.toLowerCase().includes("quilt") ? ShoppingBag : TrendingDown);

const statusLabel: Record<string, { text: string; tone: "ok" | "alert" | "muted" }> = {
  normal: { text: "Normal", tone: "ok" },
  alarm_triggered: { text: "Alert", tone: "alert" },
  alarm_active: { text: "Alert (active)", tone: "alert" },
  no_quilt_orders_yet: { text: "No quilt orders yet", tone: "muted" },
  no_quilt_products: { text: "No quilt products mapped", tone: "muted" },
  no_active_rule: { text: "Rule inactive", tone: "muted" },
  insufficient_data: { text: "Insufficient data", tone: "muted" },
  rule_inactive: { text: "Paused", tone: "muted" },
  error: { text: "Check failed", tone: "muted" },
};

function AlarmRules() {
  const [rules, setRules] = useState<AlarmRuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update rule");
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = rules.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Automation / Monitoring</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Alarm Rules</h1>
        <p className="mt-2 text-sm text-slate-500">
          Configure and review your store monitoring conditions - live from the backend.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
              <Bell size={21} />
            </div>
            <div>
              <p className="text-sm text-slate-500">Configured Rules</p>
              <h2 className="text-2xl font-bold">{loading ? "…" : String(rules.length).padStart(2, "0")}</h2>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
              <ShieldCheck size={21} />
            </div>
            <div>
              <p className="text-sm text-slate-500">Active Rules</p>
              <h2 className="text-2xl font-bold">{loading ? "…" : `${activeCount} / ${rules.length}`}</h2>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {!loading && rules.length === 0 && (
          <p className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
            No alarm rules found yet. Rules are created automatically the first time each check runs.
          </p>
        )}

        {rules.map((rule) => {
          const Icon = iconFor(rule.title);
          const live = rule.live_status ? statusLabel[rule.live_status] : null;

          return (
            <div key={rule.id} className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="flex gap-4">
                  <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                    <Icon size={23} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-blue-600">RULE #{String(rule.id).padStart(2, "0")}</p>
                    <h3 className="mt-1 text-lg font-bold text-slate-900">{rule.title}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      {rule.description ?? "—"}
                    </p>
                  </div>
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

              <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Clock3 size={17} className="text-slate-400" />
                  Last checked {timeAgo(rule.last_checked_at)}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Mail size={17} className="text-slate-400" />
                  Last triggered {rule.last_triggered_at ? timeAgo(rule.last_triggered_at) : "never"}
                </div>
                {live && (
                  <span
                    className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${
                      live.tone === "alert"
                        ? "bg-red-50 text-red-700"
                        : live.tone === "ok"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {live.text}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AlarmRules;
