import { useEffect, useState } from "react";
import { Activity, Bell, Clock3, Mail, ShieldCheck, TrendingDown } from "lucide-react";
import { api, timeAgo, type AlertItem } from "../../services/api";

function AlertHistory() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .alerts(100)
      .then(setAlerts)
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load alerts"))
      .finally(() => setLoading(false));
  }, []);

  const openCount = alerts.filter((a) => !a.resolved_at && a.status !== "resolved").length;
  const emailsSent = alerts.filter((a) => a.status === "sent").length;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Automation / Notifications</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Alert History</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review monitoring events and notification activity.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <Activity className="text-blue-600" size={22} />
          <p className="mt-3 text-sm text-slate-500">Total Events</p>
          <h2 className="mt-1 text-2xl font-bold">{loading ? "…" : pad(alerts.length)}</h2>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <Mail className="text-violet-600" size={22} />
          <p className="mt-3 text-sm text-slate-500">Emails Sent</p>
          <h2 className="mt-1 text-2xl font-bold">{loading ? "…" : pad(emailsSent)}</h2>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <ShieldCheck className="text-emerald-600" size={22} />
          <p className="mt-3 text-sm text-slate-500">Open Alerts</p>
          <h2 className="mt-1 text-2xl font-bold">{loading ? "…" : pad(openCount)}</h2>
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-6">
          <h2 className="font-bold text-slate-900">Recent Activity</h2>
          <p className="mt-1 text-xs text-slate-500">Alerts triggered by live store monitoring</p>
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load alerts: {error}
          </p>
        )}

        {!loading && !error && alerts.length === 0 && (
          <p className="text-sm text-slate-500">
            No alerts yet. Both rules are monitoring the store — alerts will appear here when a
            condition is met.
          </p>
        )}

        <div className="space-y-5">
          {alerts.map((item) => {
            const resolved = !!item.resolved_at || item.status === "resolved";
            const Icon = item.rule?.toLowerCase().includes("conversion") ? TrendingDown : Bell;

            return (
              <div key={item.id} className="flex gap-4 border-b pb-5 last:border-0 last:pb-0">
                <div className={`h-fit rounded-xl p-3 ${resolved ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600"}`}>
                  <Icon size={20} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{item.rule ?? "Alert"}</h3>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${resolved ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {resolved ? "Resolved" : "Open"}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-500">{item.message}</p>

                  <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                    <Clock3 size={14} />
                    {item.triggered_at ? new Date(item.triggered_at).toLocaleString() : "—"} ·{" "}
                    {timeAgo(item.triggered_at)}
                    {item.resolved_at && ` · resolved ${timeAgo(item.resolved_at)}`} · ALT-
                    {String(item.id).padStart(3, "0")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default AlertHistory;
