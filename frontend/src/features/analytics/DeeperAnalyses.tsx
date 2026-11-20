import { useEffect, useMemo, useState } from "react";
import { Layers, Repeat, Tag, Tags, UserPlus } from "lucide-react";
import type { EChartsOption } from "echarts";
import EChart, { FONT, tipBase, useOceanTheme } from "../../components/EChart";
import { BuyHeatmapCard } from "../dashboard/OceanCharts";
import { api, type DeeperData, type DiscountStats } from "../../services/api";

// Manager checklist section 9 (stage 1): price bands, discount codes,
// bought-together pairs, and the hour x day heatmap - all from Shopify.

type Range = 7 | 30 | 60;
const RANGES: { key: Range; label: string }[] = [
  { key: 7, label: "Last 7 days" },
  { key: 30, label: "Last 30 days" },
  { key: 60, label: "Last 60 days" },
];

const money = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;

function Card({ icon: Icon, title, sub, children }: { icon: typeof Tag; title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl bg-sky-50 p-2 text-sky-600"><Icon size={18} /></div>
        <div>
          <h3 className="font-bold text-slate-900">{title}</h3>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function PriceBands({ data }: { data: NonNullable<DeeperData["price_bands"]> }) {
  const t = useOceanTheme();
  const rows = data.rows;
  const option = useMemo<EChartsOption>(() => ({
    textStyle: { fontFamily: FONT },
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    tooltip: {
      trigger: "axis", ...tipBase(t),
      formatter: (ps: unknown) => {
        const arr = ps as { dataIndex: number }[];
        const r = rows[arr[0].dataIndex];
        return `<b>${r.band}</b><br/>Net sales ${money(r.net_sales)} (${r.share_of_sales ?? "—"}%)<br/>${r.orders.toLocaleString()} orders · ${r.items.toLocaleString()} items · ${r.products} products`
          + (r.conversion_rate != null ? `<br/>Conversion ${r.conversion_rate}% of ${r.views?.toLocaleString()} views` : "");
      },
    },
    xAxis: { type: "category", data: rows.map((r) => r.band), axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } },
    yAxis: [
      { type: "value", axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}` }, splitLine: { lineStyle: { color: t.grid } } },
      { type: "value", show: data.conversion_available, axisLabel: { color: t.muted, fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } },
    ],
    series: [
      { name: "Net sales", type: "bar", data: rows.map((r) => r.net_sales), barMaxWidth: 46, itemStyle: { color: t.main, borderRadius: [6, 6, 0, 0] } },
      ...(data.conversion_available
        ? [{ name: "Conversion", type: "line" as const, yAxisIndex: 1, data: rows.map((r) => r.conversion_rate), smooth: true, symbolSize: 8, lineStyle: { width: 3, color: t.mark }, itemStyle: { color: t.mark } }]
        : []),
    ],
  }), [rows, t, data.conversion_available]);

  return (
    <>
      <EChart option={option} height={280} />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-400">
              <th className="py-2 pr-4 font-medium">Price</th>
              <th className="py-2 pr-4 text-right font-medium">Products</th>
              <th className="py-2 pr-4 text-right font-medium">Orders</th>
              <th className="py-2 pr-4 text-right font-medium">Items</th>
              <th className="py-2 pr-4 text-right font-medium">Net sales</th>
              <th className="py-2 text-right font-medium">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.band} className="border-b border-slate-50 last:border-0">
                <td className="py-2.5 pr-4 font-medium text-slate-800">{r.band}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.products}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.orders.toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.items.toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-slate-800">{money(r.net_sales)} <span className="text-xs text-slate-400">{r.share_of_sales}%</span></td>
                <td className="py-2.5 text-right font-semibold text-slate-800">{r.conversion_rate == null ? "—" : `${r.conversion_rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatTile({ label, s, tone }: { label: string; s: DiscountStats; tone: string }) {
  return (
    <div className={`kpi-tile ${tone} rounded-2xl p-5 shadow-sm`}>
      <p className="relative text-sm font-medium text-white/90">{label}</p>
      <p className="relative mt-2 text-3xl font-semibold tracking-tight text-white">{money(s.aov, 2)}</p>
      <p className="relative text-xs text-white/80">average order value</p>
      <div className="relative mt-3 flex flex-wrap gap-2 text-xs font-semibold text-white">
        <span className="kpi-chip">{s.orders.toLocaleString()} orders · {s.share_of_orders ?? 0}%</span>
        <span className="kpi-chip">{money(s.net_sales)} net sales</span>
        {s.discount_given > 0 && <span className="kpi-chip">{money(s.discount_given)} discount</span>}
      </div>
    </div>
  );
}

function Discounts({ data }: { data: NonNullable<DeeperData["discounts"]> }) {
  const diff = data.with_code.aov != null && data.without_code.aov != null
    ? ((data.with_code.aov - data.without_code.aov) / data.without_code.aov) * 100 : null;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <StatTile label="Orders with a discount code" s={data.with_code} tone="kpi-indigo" />
        <StatTile label="Orders without a code" s={data.without_code} tone="kpi-teal" />
      </div>
      {diff != null && (
        <p className="mt-3 text-sm text-slate-600">
          Orders with a code spend <b className={diff >= 0 ? "text-emerald-600" : "text-rose-600"}>{diff >= 0 ? "+" : ""}{diff.toFixed(1)}%</b> vs orders without.
        </p>
      )}
      {data.codes.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-400">
                <th className="py-2 pr-4 font-medium">Code{data.code_count > data.codes.length ? ` (top ${data.codes.length} of ${data.code_count})` : ""}</th>
                <th className="py-2 pr-4 text-right font-medium">Orders</th>
                <th className="py-2 pr-4 text-right font-medium">Share of orders</th>
                <th className="py-2 pr-4 text-right font-medium">AOV</th>
                <th className="py-2 pr-4 text-right font-medium">Discount given</th>
                <th className="py-2 text-right font-medium">Avg. discount</th>
              </tr>
            </thead>
            <tbody>
              {data.codes.map((c) => (
                <tr key={c.code} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 pr-4"><span className="rounded-md bg-violet-50 px-2 py-0.5 font-mono text-xs font-semibold text-violet-700">{c.code}</span></td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{c.orders.toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{c.share_of_orders}%</td>
                  <td className="py-2.5 pr-4 text-right font-semibold tabular-nums text-slate-800">{money(c.aov, 2)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{money(c.discount_given)}</td>
                  <td className="py-2.5 text-right tabular-nums text-slate-600">{money(c.avg_discount, 2)} <span className="text-xs text-slate-400">{c.discount_pct}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BoughtTogether({ data }: { data: NonNullable<DeeperData["bought_together"]> }) {
  const max = Math.max(1, ...data.rows.map((r) => r.orders_together));
  if (!data.rows.length) return <p className="text-sm text-slate-500">No orders with two or more products in these dates.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-slate-400">
            <th className="py-2 pr-2 font-medium">#</th>
            <th className="py-2 pr-4 font-medium">Products bought together</th>
            <th className="py-2 pr-4 text-right font-medium">Orders together</th>
            <th className="py-2 pr-4 text-right font-medium">% of first</th>
            <th className="py-2 pr-4 text-right font-medium">% of second</th>
            <th className="py-2 text-right font-medium">Lift</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={`${r.a}|${r.b}`} className="border-b border-slate-50 last:border-0">
              <td className="py-2.5 pr-2 text-xs font-semibold text-slate-400">{i + 1}</td>
              <td className="py-2.5 pr-4">
                <p className="font-medium text-slate-800">{r.a}</p>
                <p className="text-slate-500">+ {r.b}</p>
              </td>
              <td className="py-2.5 pr-4 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="hidden h-1.5 w-24 rounded-full bg-slate-100 sm:block">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${(r.orders_together / max) * 100}%` }} />
                  </div>
                  <span className="font-semibold tabular-nums text-slate-800">{r.orders_together}</span>
                </div>
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.pct_of_a}%</td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.pct_of_b}%</td>
              <td className={`py-2.5 text-right font-semibold tabular-nums ${(r.lift ?? 0) >= 2 ? "text-emerald-600" : "text-slate-700"}`}>
                {r.lift == null ? "—" : `${r.lift}×`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Hist({ title, rows, color }: { title: string; rows: { label: string; orders: number; share: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.share));
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[90px_1fr_70px] items-center gap-3 text-sm">
            <span className="text-slate-600">{r.label}</span>
            <div className="h-2.5 rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${(r.share / max) * 100}%` }} />
            </div>
            <span className="text-right tabular-nums text-slate-700">{r.share}% <span className="text-xs text-slate-400">{r.orders}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewVsReturning({ data }: { data: NonNullable<DeeperData["new_vs_returning"]> }) {
  const f = data.first_order;
  const tile = (label: string, s: typeof data.new, cls: string) => (
    <div className={`kpi-tile ${cls} rounded-2xl p-5 shadow-sm`}>
      <p className="relative text-sm font-medium text-white/90">{label}</p>
      <p className="relative mt-2 text-3xl font-semibold tracking-tight text-white">{s.share_of_orders}%</p>
      <p className="relative text-xs text-white/80">of orders</p>
      <div className="relative mt-3 flex flex-wrap gap-2 text-xs font-semibold text-white">
        <span className="kpi-chip">{s.orders.toLocaleString()} orders</span>
        <span className="kpi-chip">AOV {money(s.aov, 2)}</span>
        <span className="kpi-chip">{money(s.net_sales)} net sales</span>
      </div>
    </div>
  );
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {tile("New customers (first order)", data.new, "kpi-blue")}
        {tile("Returning customers", data.returning, "kpi-rose")}
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-4">
          <p className="text-sm text-slate-600">
            Visits before a first order: median <b className="text-slate-900">{f.median_visits ?? "—"}</b>
          </p>
          <div className="mt-3"><Hist title={`${f.with_visits.toLocaleString()} first orders`} rows={f.visits} color="bg-sky-500" /></div>
        </div>
        <div className="rounded-xl border border-slate-100 p-4">
          <p className="text-sm text-slate-600">
            Days from first visit to first order: median <b className="text-slate-900">{f.median_days ?? "—"}</b>
          </p>
          <div className="mt-3"><Hist title={`${f.with_days.toLocaleString()} first orders`} rows={f.days} color="bg-teal-500" /></div>
        </div>
      </div>
    </>
  );
}

function RepeatPurchase({ data }: { data: NonNullable<DeeperData["repeat_purchase"]> }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-3xl font-bold tracking-tight text-slate-900">{data.repeat_rate}%</p>
        <p className="text-sm text-slate-600">
          of {data.first_time_buyers.toLocaleString()} first-time buyers have ordered again ({data.came_back.toLocaleString()} customers)
        </p>
      </div>
      {data.rows.length === 0 ? (
        <p className="text-sm text-slate-500">No product had {data.min_buyers}+ first-time buyers in these dates.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-400">
                <th className="py-2 pr-4 font-medium">First product bought</th>
                <th className="py-2 pr-4 text-right font-medium">First-time buyers</th>
                <th className="py-2 pr-4 text-right font-medium">Came back</th>
                <th className="py-2 text-right font-medium">Repeat rate</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const good = r.repeat_rate >= data.repeat_rate;
                return (
                  <tr key={r.product} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{r.product}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.first_time_buyers.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.came_back.toLocaleString()}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 w-24 rounded-full bg-slate-100 sm:block">
                          <div className={`h-full rounded-full ${good ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${Math.min(r.repeat_rate, 100)}%` }} />
                        </div>
                        <span className={`font-semibold tabular-nums ${good ? "text-emerald-600" : "text-slate-700"}`}>{r.repeat_rate}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DeeperAnalyses() {
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<DeeperData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .deeper(range)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load"));
    return () => {
      alive = false;
    };
  }, [range]);

  const wl = data?.window_label;
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Deeper Analyses</h1>
          <p className="mt-1 text-sm text-slate-500">{wl ? <>Showing <b className="text-sky-700">{wl}</b> · orders from Shopify, test and cancelled left out</> : "Loading from Shopify…"}</p>
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

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {data && Object.keys(data.errors).length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Some parts couldn't be loaded from Shopify: {Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join(" · ")}
        </div>
      )}
      {!data && !error && (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">Reading orders from Shopify… the first load for a range can take up to a minute.</div>
      )}

      {data && (
        <>
          <Card
            icon={Tags}
            title="Price bands"
            sub={<>{wl} · net sales and orders by product price{data.price_bands?.conversion_available ? <> · conversion = buyers ÷ product views ({data.price_bands.views_window_label})</> : ""}</>}
          >
            {data.price_bands ? <PriceBands data={data.price_bands} /> : <p className="text-sm text-slate-500">Couldn't load price bands.</p>}
          </Card>

          <Card icon={Tag} title="Discount codes" sub={<>{wl} · {data.discounts?.total_orders.toLocaleString() ?? "—"} orders · AOV = subtotal after discounts, before shipping and tax</>}>
            {data.discounts ? <Discounts data={data.discounts} /> : <p className="text-sm text-slate-500">Couldn't load orders.</p>}
          </Card>

          <Card
            icon={Layers}
            title="Bought together"
            sub={data.bought_together ? <>{wl} · top 20 pairs · {data.bought_together.multi_product_orders.toLocaleString()} of {data.bought_together.orders.toLocaleString()} orders ({data.bought_together.multi_share}%) had 2+ products · lift 2× = bought together twice as often as chance</> : wl}
          >
            {data.bought_together ? <BoughtTogether data={data.bought_together} /> : <p className="text-sm text-slate-500">Couldn't load orders.</p>}
          </Card>

          <Card
            icon={UserPlus}
            title="New vs returning customers"
            sub={data.new_vs_returning ? <>{wl} · {data.new_vs_returning.orders_with_journey.toLocaleString()} orders with customer journey data from Shopify</> : wl}
          >
            {data.new_vs_returning ? <NewVsReturning data={data.new_vs_returning} /> : (
              <p className="text-sm text-slate-500">Shopify didn't share customer journey data with the app, so this can't be shown yet.</p>
            )}
          </Card>

          <Card
            icon={Repeat}
            title="Repeat purchase by first product"
            sub={data.repeat_purchase ? <>First orders placed {wl} · came back = ordered again by today · products with {data.repeat_purchase.min_buyers}+ first-time buyers</> : wl}
          >
            {data.repeat_purchase ? <RepeatPurchase data={data.repeat_purchase} /> : (
              <p className="text-sm text-slate-500">
                {data.customer_data?.customers === false
                  ? "The Shopify app needs permission to read customers (read_customers) to show this."
                  : "No first-time buyers in these dates."}
              </p>
            )}
          </Card>
        </>
      )}

      <BuyHeatmapCard />
    </div>
  );
}

export default DeeperAnalyses;
