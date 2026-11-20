import { useEffect, useState } from "react";
import { CreditCard, Info, Layers, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, formatMoney, type CartExtras as CartExtrasData, type LandingRange, type PaymentRow } from "../../services/api";
import RangePicker, { rangeLabel } from "../../components/RangePicker";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";

// Cart and checkout extras (manager checklist, section 6, P2/P3).

const THRESHOLD_KEY = "cro.freeShippingThreshold";

function readThreshold(): number | null {
  try {
    const v = Number(localStorage.getItem(THRESHOLD_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function PaymentTable({ rows, label, avg }: { rows: PaymentRow[]; label: string; avg: number | null }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-slate-400">
          <th className="py-2 pr-4 font-medium">{label}</th>
          <th className="py-2 pr-4 text-right font-medium">Share of payments</th>
          <th className="py-2 pr-4 text-right font-medium">Attempts</th>
          <th className="py-2 pr-4 text-right font-medium">Failed attempts</th>
          <th className="py-2 text-right font-medium">Success rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          // Clearly below the store's overall success rate -> red.
          const bad = avg != null && r.authorization_rate != null && r.attempts >= 30 && r.authorization_rate < avg - 5;
          return (
            <tr key={r.label} className="border-b border-slate-50 last:border-0">
              <td className="py-2.5 pr-4 font-medium capitalize text-slate-800">{r.label}</td>
              <td className="py-2.5 pr-4 text-right text-slate-600">{r.share_of_payments == null ? "—" : `${r.share_of_payments}%`}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.attempts.toLocaleString()}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{r.failed_attempts.toLocaleString()}</td>
              <td className={`py-2.5 text-right font-semibold ${bad ? "text-red-600" : "text-slate-800"}`}>
                {r.authorization_rate == null ? "—" : `${r.authorization_rate}%`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CartExtras() {
  const [threshold, setThreshold] = useState<number | null>(readThreshold);
  const [draft, setDraft] = useState(threshold ? String(threshold) : "");
  const [range, setRange] = useState<LandingRange>(28);
  const [data, setData] = useState<CartExtrasData | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.summary().catch(() => null), api.cartExtras(range, threshold)])
      .then(([s, d]) => {
        if (!alive) return;
        if (s) setCurrency(s.store.currency);
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load"));
    return () => {
      alive = false;
    };
  }, [threshold, range]);

  const saveThreshold = () => {
    const v = Number(draft);
    const next = v > 0 ? v : null;
    try {
      if (next) localStorage.setItem(THRESHOLD_KEY, String(next));
      else localStorage.removeItem(THRESHOLD_KEY);
    } catch {
      /* storage blocked - still works for this visit */
    }
    setThreshold(next);
  };

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-bold text-slate-900">Payments, order values &amp; basket size</h3>
        <p className="text-xs text-slate-500">
          {data ? <>Showing: <b className="text-blue-700">{data.window_label}</b></> : `Loading ${rangeLabel(range)}…`}
        </p>
      </div>
      <RangePicker
        value={range}
        onChange={(r) => {
          setData(null); // never show the old range's numbers under the new button
          setRange(r);
        }}
      />
    </div>
  );

  if (error) return <div className="space-y-4">{header}<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div></div>;
  if (!data) return <div className="space-y-4">{header}<p className="text-sm text-slate-400">Loading {rangeLabel(range)} from Shopify…</p></div>;

  const ov = data.order_values;
  const ip = data.items_per_order;
  const p = data.payments;

  return (
    <div className="space-y-6">
      {header}
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-1 flex items-center gap-2">
          <CreditCard className="text-blue-500" size={20} />
          <h3 className="font-bold text-slate-900">Payment methods &amp; failed payments<InfoTip text={HELP.payments} /></h3>
        </div>
        <p className="mb-4 text-xs text-slate-500">{data.window_label}</p>
        {p && data.payments_error && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.payments_error}</p>
        )}
        {!p ? (
          <p className="text-xs text-slate-400">Payment data couldn't be loaded from Shopify{data.payments_error ? ` (${data.payments_error})` : ""}.</p>
        ) : (
          <>
            <div className="mb-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border p-4">
                <p className="text-xs text-slate-500">Payment success rate</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{p.authorization_rate == null ? "—" : `${p.authorization_rate}%`}</p>
                <p className="cro-note mt-1 text-xs text-slate-400">{p.successful.toLocaleString()} of {p.attempts.toLocaleString()} purchase attempts</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs text-slate-500">Failed payment attempts</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{p.failed_attempts.toLocaleString()}</p>
                <p className="cro-note mt-1 text-xs text-slate-400">includes retries by the same customer</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs text-slate-500">Most used method</p>
                <p className="mt-2 text-2xl font-bold capitalize text-slate-900">{p.methods[0]?.label ?? "—"}</p>
                <p className="cro-note mt-1 text-xs text-slate-400">{p.methods[0]?.share_of_payments ?? "—"}% of successful payments</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <PaymentTable rows={p.methods} label="Method" avg={p.authorization_rate} />
            </div>
            {p.wallets.length > 0 && (
              <div className="mt-5 overflow-x-auto">
                <PaymentTable rows={p.wallets} label="Wallet (Shop Pay, Apple Pay…)" avg={p.authorization_rate} />
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Truck className="text-blue-500" size={20} />
            <div>
              <h3 className="font-bold text-slate-900">Order values &amp; free-shipping threshold<InfoTip text={HELP.orderValues} /></h3>
              <p className="text-xs text-slate-500">{data.window_label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="fs-threshold" className="text-xs text-slate-500">Free shipping from</label>
            <input
              id="fs-threshold"
              type="number"
              min={0}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={data.order_values.threshold ? String(data.order_values.threshold) : "e.g. 150"}
              className="w-24 rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-blue-300"
            />
            <button onClick={saveThreshold} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">Apply</button>
          </div>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-slate-500">Average / median order</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{ov.average == null ? "—" : formatMoney(ov.average, currency)}</p>
            <p className="cro-note mt-1 text-xs text-slate-400">median {ov.median == null ? "—" : formatMoney(ov.median, currency)} · {ov.orders.toLocaleString()} orders</p>
          </div>
          <div className={`rounded-xl border p-4 ${ov.threshold ? "border-amber-200 bg-amber-50" : ""}`}>
            <p className="text-xs text-slate-500">Orders just below free shipping</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{ov.near_threshold_share == null ? "—" : `${ov.near_threshold_share}%`}</p>
            <p className="cro-note mt-1 text-xs text-slate-400">
              {ov.threshold
                ? `${ov.near_threshold_orders} orders between ${formatMoney(ov.near_threshold_from ?? 0, currency)} and ${formatMoney(ov.threshold, currency)}`
                : "Enter your free-shipping amount above"}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-slate-500">Orders that qualified</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{ov.at_or_above_threshold_share == null ? "—" : `${ov.at_or_above_threshold_share}%`}</p>
            <p className="cro-note mt-1 text-xs text-slate-400">{ov.threshold ? `at or above ${formatMoney(ov.threshold, currency)}` : "—"}</p>
          </div>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ov.bars} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip formatter={(v, _n, item) => [`${v} orders (${(item.payload as { share: number }).share}%)`, "Orders"]} />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {ov.bars.map((b) => <Cell key={b.label} fill={b.below_threshold_zone ? "#f59e0b" : "#3b82f6"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="cro-note mt-2 text-xs text-slate-500">
          Order value = subtotal after discounts, before shipping and tax. {ov.threshold ? "Amber bars = orders just below free shipping." : ""}
        </p>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Layers className="text-blue-500" size={20} />
          <div>
            <h3 className="font-bold text-slate-900">Items per order<InfoTip text={HELP.itemsPerOrder} /></h3>
            <p className="text-xs text-slate-500">{data.window_label}</p>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500">Average items per order</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{ip.average_items ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Single-item orders</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{ip.single_item_share == null ? "—" : `${ip.single_item_share}%`}</p>
            </div>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ip.bars} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} label={{ value: "items in the order", position: "insideBottom", offset: -2, fill: "#94a3b8", fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip formatter={(v, _n, item) => [`${v} orders (${(item.payload as { share: number }).share}%)`, "Orders"]} />
                <Bar dataKey="orders" fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <div className="cro-note flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <Info size={15} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Not shown yet</p>
          {data.not_available.map((n) => <p key={n}>{n}</p>)}
        </div>
      </div>
    </div>
  );
}

export default CartExtras;
