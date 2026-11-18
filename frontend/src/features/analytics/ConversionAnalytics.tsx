import { useEffect, useMemo, useState } from "react";
import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type CvrDay, type DashboardSummary } from "../../services/api";

type Grouping = "daily" | "weekly" | "monthly";

function groupData(days: CvrDay[], mode: Grouping) {
  if (mode === "daily") return days.map((d) => ({ label: d.date.slice(5), sessions: d.sessions, cvr: d.cvr }));

  const buckets = new Map<string, { sessions: number; orders: number }>();
  for (const d of days) {
    const date = new Date(`${d.date}T00:00:00`);
    let key: string;
    if (mode === "weekly") {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().slice(0, 10);
    } else {
      key = d.date.slice(0, 7);
    }
    const existing = buckets.get(key) ?? { sessions: 0, orders: 0 };
    existing.sessions += d.sessions;
    existing.orders += d.cvr != null ? Math.round((d.cvr / 100) * d.sessions) : 0;
    buckets.set(key, existing);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      label: key,
      sessions: v.sessions,
      cvr: v.sessions ? Math.round((v.orders / v.sessions) * 1000) / 10 : null,
    }));
}

function ConversionAnalytics() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [days, setDays] = useState<CvrDay[]>([]);
  const [grouping, setGrouping] = useState<Grouping>("daily");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.summary(), api.cvrTrend(30)])
      .then(([s, t]) => {
        setSummary(s);
        setDays(t.days);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load conversion data"))
      .finally(() => setLoading(false));
  }, []);

  const chartData = useMemo(() => groupData(days, grouping), [days, grouping]);
  const cvr = summary?.cvr;
  const dropping = cvr?.drop_percent != null && cvr.drop_percent > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Main / Analytics</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Conversion Analytics</h1>
        <p className="mt-2 text-sm text-slate-500">
          Conversion rate = orders placed ÷ online store sessions, from Shopify Analytics, in your store's timezone.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Yesterday's CVR</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? "…" : (cvr?.yesterday_cvr != null ? `${cvr.yesterday_cvr}%` : "—")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{cvr?.yesterday_date ?? "—"}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Previous Day's CVR</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? "…" : (cvr?.previous_cvr != null ? `${cvr.previous_cvr}%` : "—")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{cvr?.previous_date ?? "—"}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Period-over-period change</p>
          <h2 className={`mt-2 flex items-center gap-1.5 text-2xl font-bold ${dropping ? "text-red-600" : "text-emerald-600"}`}>
            {cvr?.drop_percent == null ? "—" : (
              <>
                {dropping ? <TrendingDown size={20} /> : <TrendingUp size={20} />}
                {Math.abs(cvr.drop_percent)}%
              </>
            )}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{dropping ? "drop vs day before" : "improvement vs day before"}</p>
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-slate-900">Conversion Rate Trend</h3>
          <div className="flex rounded-lg border border-slate-200 p-1 text-xs">
            {(["daily", "weekly", "monthly"] as Grouping[]).map((g) => (
              <button
                key={g}
                onClick={() => setGrouping(g)}
                className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${grouping === g ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        {chartData.length === 0 ? (
          <p className="text-xs text-slate-400">{loading ? "Loading…" : "No conversion data available."}</p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cvrGradient2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} unit="%" />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Area type="monotone" dataKey="cvr" stroke="#3b82f6" strokeWidth={3} fill="url(#cvrGradient2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <Info size={15} className="mt-0.5 shrink-0" />
        Sessions-to-order conversion only counts Shopify Online Store sessions. Draft/manual orders and
        app-channel sales aren't reflected in this metric.
      </div>
    </div>
  );
}

export default ConversionAnalytics;
