import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Info, TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Benchmarks, type CvrDay, type DashboardSummary, type SegmentRow, type SegmentSplit } from "../../services/api";

type SortKey = "sessions" | "added_to_cart_rate" | "conversion_rate" | "orders";

// "Split by device: mobile, desktop, tablet (sortable table)" / "Split by
// channel: Meta, Google, organic search, email, direct, referral (sortable
// table)" (checklist section 3, P1).
function SegmentTable({ title, data, loading }: { title: string; data: SegmentSplit | null; loading: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("sessions");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDesc ? bv - av : av - bv;
    });
    return rows;
  }, [data, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const columns: { key: SortKey; label: string }[] = [
    { key: "sessions", label: "Sessions" },
    { key: "added_to_cart_rate", label: "Add-to-cart rate" },
    { key: "conversion_rate", label: "Conversion rate" },
    { key: "orders", label: "Orders" },
  ];

  const renderChange = (row: SegmentRow) => {
    if (row.sessions_change_pct === null) return <span className="text-slate-400">—</span>;
    const up = row.sessions_change_pct >= 0;
    return (
      <span className={`inline-flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-red-600"}`}>
        {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
        {Math.abs(row.sessions_change_pct)}%
      </span>
    );
  };

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-400">Last {data?.days ?? 7} days vs prior {data?.days ?? 7} days</p>
      </div>
      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : !data || sorted.length === 0 ? (
        <p className="text-xs text-slate-400">No session data available for this split.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="py-2 pr-4 font-medium">{title.includes("Device") ? "Device" : "Channel"}</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className="cursor-pointer select-none py-2 pr-4 font-medium hover:text-slate-600"
                  >
                    {col.label} {sortKey === col.key ? (sortDesc ? "↓" : "↑") : ""}
                  </th>
                ))}
                <th className="py-2 pr-4 font-medium">vs prior period</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.label} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{row.label}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{row.sessions.toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{row.added_to_cart_rate != null ? `${row.added_to_cart_rate}%` : "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{row.conversion_rate != null ? `${row.conversion_rate}%` : "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{row.orders}</td>
                  <td className="py-2.5 pr-4">{renderChange(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && !data.revenue_available && (
        <p className="mt-3 text-xs text-slate-400">{data.revenue_note}</p>
      )}
    </section>
  );
}

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
  const [benchmarks, setBenchmarks] = useState<Benchmarks | null>(null);
  const [deviceSplit, setDeviceSplit] = useState<SegmentSplit | null>(null);
  const [channelSplit, setChannelSplit] = useState<SegmentSplit | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.summary(), api.cvrTrend(30), api.benchmarks()])
      .then(([s, t, b]) => {
        setSummary(s);
        setDays(t.days);
        setBenchmarks(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load conversion data"))
      .finally(() => setLoading(false));

    Promise.all([
      api.segments("device", 7).catch(() => null),
      api.segments("channel", 7).catch(() => null),
    ])
      .then(([d, c]) => {
        setDeviceSplit(d);
        setChannelSplit(c);
      })
      .finally(() => setSegmentsLoading(false));
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
          {benchmarks && cvr?.yesterday_cvr != null && (
            <p className="mt-2 text-xs">
              <span className={cvr.yesterday_cvr >= benchmarks.conversion_rate.value ? "text-emerald-600" : "text-amber-600"}>
                {cvr.yesterday_cvr >= benchmarks.conversion_rate.value ? "Above" : "Below"} industry avg (
                {benchmarks.conversion_rate.value}%)
              </span>
            </p>
          )}
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

      <div className="grid gap-6 xl:grid-cols-2">
        <SegmentTable title="Split by Device" data={deviceSplit} loading={segmentsLoading} />
        <SegmentTable title="Split by Channel" data={channelSplit} loading={segmentsLoading} />
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <Info size={15} className="mt-0.5 shrink-0" />
        Sessions-to-order conversion only counts Shopify Online Store sessions. Draft/manual orders and
        app-channel sales aren't reflected in this metric.
        {benchmarks && ` Industry avg conversion rate benchmark: ${benchmarks.conversion_rate.source}.`}
      </div>
    </div>
  );
}

export default ConversionAnalytics;
