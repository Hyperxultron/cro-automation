import { useEffect, useState } from "react";
import { Filter } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import CartExtras from "./CartExtras";
import AbandonmentTrend from "./AbandonmentTrend";
import { api, type Benchmarks, type Funnel, type FunnelTrendDay } from "../../services/api";
import { ptsBothFromValues } from "../../lib/change";

function CartCheckoutAnalytics() {
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [trend, setTrend] = useState<FunnelTrendDay[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmarks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.funnel(), api.funnelTrend(8), api.benchmarks()])
      .then(([f, t, b]) => {
        setFunnel(f);
        setTrend(t.trend);
        setBenchmarks(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load funnel data"))
      .finally(() => setLoading(false));
  }, []);

  const stages = funnel
    ? [
        { label: "Sessions", value: funnel.sessions, pct: 100 },
        { label: "Added to Cart", value: funnel.added_to_cart, pct: funnel.cart_rate ?? 0 },
        { label: "Reached Checkout", value: funnel.reached_checkout, pct: funnel.checkout_rate ?? 0 },
        { label: "Completed Purchase", value: funnel.completed_checkout, pct: funnel.conversion_rate ?? 0 },
      ]
    : [];

  const cartAbandon = funnel?.added_to_cart
    ? Math.round(((funnel.added_to_cart - funnel.completed_checkout) / funnel.added_to_cart) * 1000) / 10
    : null;
  const checkoutAbandon = funnel?.reached_checkout
    ? Math.round(((funnel.reached_checkout - funnel.completed_checkout) / funnel.reached_checkout) * 1000) / 10
    : null;

  // Same weekday last week, for the change chip on the two tiles.
  const lastWeekRow = (() => {
    if (!funnel?.date) return null;
    const d = new Date(`${funnel.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    const iso = d.toISOString().slice(0, 10);
    return trend.find((r) => r.date === iso) ?? null;
  })();
  const dayLabel = (iso?: string | null) =>
    iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "Yesterday";
  const chip = (cur: number | null, prev: number | null | undefined) => {
    if (cur == null || prev == null) return null;
    const d = Math.round((cur - prev) * 10) / 10;
    return (
      <span className={`ml-2 rounded-md px-1.5 py-0.5 text-xs font-semibold ${d === 0 ? "bg-slate-100 text-slate-500" : d < 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
        {d > 0 ? "▲ " : d < 0 ? "▼ " : ""}{ptsBothFromValues(cur, prev)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Main / Analytics</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Cart &amp; Checkout Analytics</h1>
        <p className="mt-2 text-sm text-slate-500">
          Sessions → Add to Cart → Checkout → Purchase, from Shopify Analytics (yesterday's full day).
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Cart Abandonment Rate</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{dayLabel(funnel?.date)} · vs {dayLabel(lastWeekRow?.date)}</p>
          <h2 className="mt-2 flex items-center text-2xl font-bold text-slate-900">
            {loading ? "…" : cartAbandon != null ? `${cartAbandon}%` : "—"}
            {!loading && chip(cartAbandon, lastWeekRow?.cart_abandonment_rate)}
          </h2>
          <p className="cro-note mt-1 text-xs text-slate-400">of sessions that added to cart but never purchased</p>
          {benchmarks && cartAbandon != null && (
            <p className="mt-2 text-xs">
              <span
                className={
                  cartAbandon <= benchmarks.cart_abandonment_rate.value ? "text-emerald-600" : "text-amber-600"
                }
              >
                {cartAbandon <= benchmarks.cart_abandonment_rate.value ? "Better than" : "Worse than"} industry avg (
                {benchmarks.cart_abandonment_rate.value}%)
              </span>
            </p>
          )}
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Checkout Abandonment Rate</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{dayLabel(funnel?.date)} · vs {dayLabel(lastWeekRow?.date)}</p>
          <h2 className="mt-2 flex items-center text-2xl font-bold text-slate-900">
            {loading ? "…" : checkoutAbandon != null ? `${checkoutAbandon}%` : "—"}
            {!loading && chip(checkoutAbandon, lastWeekRow?.checkout_abandonment_rate)}
          </h2>
          <p className="cro-note mt-1 text-xs text-slate-400">of sessions that reached checkout but never purchased</p>
          {benchmarks && checkoutAbandon != null && (
            <p className="mt-2 text-xs">
              <span
                className={
                  checkoutAbandon <= benchmarks.checkout_abandonment_rate.value ? "text-emerald-600" : "text-amber-600"
                }
              >
                {checkoutAbandon <= benchmarks.checkout_abandonment_rate.value ? "Better than" : "Worse than"} industry avg (
                {benchmarks.checkout_abandonment_rate.value}%)
              </span>
            </p>
          )}
        </div>
      </div>
      {benchmarks && (
        <p className="cro-note text-xs text-slate-400">
          Industry averages: {benchmarks.cart_abandonment_rate.source}.
        </p>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900">Funnel - {funnel?.date ?? "yesterday"}</h3>
            <p className="mt-1 text-xs text-slate-400">Each stage as a share of total sessions</p>
          </div>
          <Filter className="text-violet-500" size={20} />
        </div>
        {!funnel || funnel.sessions === 0 ? (
          <p className="text-xs text-slate-400">{loading ? "Loading…" : "No session data available for this period."}</p>
        ) : (
          <div className="space-y-4">
            {stages.map((stage) => (
              <div key={stage.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-600">{stage.label}</span>
                  <span className="font-semibold text-slate-900">
                    {stage.value.toLocaleString()} <span className="text-slate-400">({stage.pct}%)</span>
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(stage.pct, 1.5)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <AbandonmentTrend />

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h3 className="mb-5 font-bold text-slate-900">Funnel Trend - Last 7 Days</h3>
        {trend.length === 0 ? (
          <p className="text-xs text-slate-400">{loading ? "Loading…" : "No trend data available."}</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend.slice(-7).map((d) => ({ day: (d.date ?? "").slice(5), Sessions: d.sessions, "Added to Cart": d.added_to_cart, Checkout: d.reached_checkout, Purchased: d.completed_checkout }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="Sessions" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Added to Cart" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Checkout" fill="#818cf8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Purchased" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <CartExtras />
    </div>
  );
}

export default CartCheckoutAnalytics;
