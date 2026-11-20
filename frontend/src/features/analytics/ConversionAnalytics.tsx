import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Info, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, formatMoney, type Benchmarks, type CvrDay, type DashboardSummary, type FunnelCompare, type SegmentRow, type SegmentSplit } from "../../services/api";
import FunnelBars from "./FunnelBars";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";

type SortKey = "sessions" | "added_to_cart_rate" | "conversion_rate" | "aov" | "revenue_per_session" | "orders";

const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// "Split by device: mobile, desktop, tablet (sortable table)" / "Split by
// channel: Meta, Google, organic search, email, direct, referral (sortable
// table)" (checklist section 3, P1).
function SegmentTable({ title, data, loading, currency }: { title: string; data: SegmentSplit | null; loading: boolean; currency?: string | null }) {
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
    ...(data?.revenue_available
      ? ([
          { key: "aov", label: "AOV" },
          { key: "revenue_per_session", label: "Revenue / session" },
        ] as { key: SortKey; label: string }[])
      : []),
    { key: "orders", label: "Orders" },
  ];

  // Change vs the prior period: conversion in points, sessions in %, and
  // revenue per session in % when available. Tiny segments say "too few"
  // instead of printing a noisy change.
  const renderChange = (row: SegmentRow) => {
    if (row.sessions < 500) return <span className="text-slate-400">Too few sessions</span>;
    const parts: { text: string; good: boolean | null }[] = [];
    if (row.conversion_rate_change_pts !== null) {
      const v = row.conversion_rate_change_pts;
      parts.push({ text: `CVR ${v > 0 ? "+" : ""}${v} pts`, good: v === 0 ? null : v > 0 });
    }
    if (row.revenue_per_session_change_pct !== null) {
      const v = row.revenue_per_session_change_pct;
      parts.push({ text: `RPS ${v > 0 ? "+" : ""}${v}%`, good: v === 0 ? null : v > 0 });
    }
    if (row.sessions_change_pct !== null) {
      const v = row.sessions_change_pct;
      parts.push({ text: `sessions ${v > 0 ? "+" : ""}${v}%`, good: null });
    }
    if (parts.length === 0) return <span className="text-slate-400">—</span>;
    return (
      <span className="flex flex-col gap-0.5 text-xs">
        {parts.map((p) => (
          <span key={p.text} className={`inline-flex items-center gap-0.5 ${p.good === null ? "text-slate-500" : p.good ? "text-emerald-600" : "text-red-600"}`}>
            {p.good !== null && (p.good ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            {p.text}
          </span>
        ))}
      </span>
    );
  };

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">{title}<InfoTip text={title.includes("Device") ? HELP.deviceSplit : HELP.channelSplit} /></h3>
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
                  {data.revenue_available && (
                    <>
                      <td className="py-2.5 pr-4 text-slate-600">{row.aov != null ? formatMoney(row.aov, currency) : "—"}</td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {row.revenue_per_session != null
                          ? new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(row.revenue_per_session)
                          : "—"}
                      </td>
                    </>
                  )}
                  <td className="py-2.5 pr-4 text-slate-600">{row.orders}</td>
                  <td className="py-2.5 pr-4">{renderChange(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.revenue_note && <p className="cro-note mt-3 text-xs text-slate-400">{data.revenue_note}</p>}
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
  const [funnelPeriod, setFunnelPeriod] = useState<"today" | "yesterday" | "last7">("last7");
  const [funnel, setFunnel] = useState<FunnelCompare | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(true);
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

  useEffect(() => {
    let cancelled = false;
    api
      .funnelCompare(funnelPeriod)
      .then((f) => !cancelled && setFunnel(f))
      .catch(() => !cancelled && setFunnel(null))
      .finally(() => !cancelled && setFunnelLoading(false));
    return () => {
      cancelled = true;
    };
  }, [funnelPeriod]);

  const chartData = useMemo(() => groupData(days, grouping), [days, grouping]);
  const cvr = summary?.cvr;
  // Compare yesterday with the same weekday last week, not the day before
  // (checklist section 1).
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const lastWeekDate = cvr?.yesterday_date ? shiftDate(cvr.yesterday_date, -7) : null;
  const lastWeek = lastWeekDate ? byDate.get(lastWeekDate) : undefined;
  const yesterdayRow = cvr?.yesterday_date ? byDate.get(cvr.yesterday_date) : undefined;
  const tooEarly = !yesterdayRow || yesterdayRow.sessions < 500;
  const changePts =
    cvr?.yesterday_cvr != null && lastWeek?.cvr != null ? Math.round((cvr.yesterday_cvr - lastWeek.cvr) * 100) / 100 : null;
  const changePct =
    changePts !== null && lastWeek?.cvr ? Math.round((changePts / lastWeek.cvr) * 1000) / 10 : null;
  const dropping = changePts !== null && changePts < 0;
  const weekdayName = lastWeekDate
    ? new Date(`${lastWeekDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })
    : "";

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
          <p className="text-sm text-slate-500">Yesterday's conversion rate<InfoTip text={HELP.conversionRate} /></p>
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
          <p className="text-sm text-slate-500">Same weekday last week</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? "…" : (lastWeek?.cvr != null ? `${lastWeek.cvr}%` : "—")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{lastWeekDate ? `${weekdayName} ${lastWeekDate}` : "—"}</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Change vs same weekday last week<InfoTip text={HELP.tooEarly} /></p>
          <h2 className={`mt-2 flex items-center gap-1.5 text-2xl font-bold ${tooEarly || changePts === null || changePts === 0 ? "text-slate-400" : dropping ? "text-red-600" : "text-emerald-600"}`}>
            {loading ? "…" : tooEarly ? (
              <span className="text-base">Too early to compare</span>
            ) : changePts === null ? "—" : (
              <>
                {changePts !== 0 && (dropping ? <TrendingDown size={20} /> : <TrendingUp size={20} />)}
                {changePts > 0 ? "+" : ""}{changePts} pts{changePct !== null ? ` (${changePct > 0 ? "+" : ""}${changePct}%)` : ""}
              </>
            )}
          </h2>
          <p className="cro-note mt-1 text-xs text-slate-400">
            {yesterdayRow ? `Base: ~${yesterdayRow.sessions.toLocaleString()} sessions yesterday` : "—"}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-slate-900">Conversion Rate Trend<InfoTip text={HELP.cvrTrend} /></h3>
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
              {/* Lines for trends, sessions as bars behind (checklist section 1 / 10). */}
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis yAxisId="cvr" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} unit="%" />
                <YAxis yAxisId="sessions" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "#cbd5e1", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                  formatter={(value, name) => (name === "sessions" ? [Number(value).toLocaleString(), "Sessions"] : [`${value}%`, "Conversion rate"])}
                />
                <Bar yAxisId="sessions" dataKey="sessions" fill="#e2e8f0" radius={[3, 3, 0, 0]} />
                <Line yAxisId="cvr" type="linear" dataKey="cvr" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">Full Funnel<InfoTip text={HELP.funnel} /></h3>
            <p className="mt-1 text-xs text-slate-400">{funnel?.period_label ?? "…"} · {funnel?.compare_label ?? ""}</p>
          </div>
          <div className="flex rounded-lg border border-slate-200 p-1 text-xs">
            {([
              { key: "last7", label: "Last 7 vs prior 7" },
              { key: "yesterday", label: "Yesterday vs last week" },
              { key: "today", label: "Today so far" },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                onClick={() => {
                  setFunnelLoading(true);
                  setFunnelPeriod(opt.key);
                }}
                className={`rounded-md px-3 py-1.5 font-medium transition ${funnelPeriod === opt.key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <FunnelBars data={funnel} loading={funnelLoading} />
      </section>

      <div className="grid gap-6">
        <SegmentTable title="Split by Device" data={deviceSplit} loading={segmentsLoading} currency={summary?.store.currency} />
        <SegmentTable title="Split by Channel" data={channelSplit} loading={segmentsLoading} currency={summary?.store.currency} />
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
