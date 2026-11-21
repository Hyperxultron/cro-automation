import { useEffect, useState } from "react";
import { CreditCard, Info, Layers, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, formatMoney, type CartCompare, type CartExtras as CartExtrasData, type LandingRange, type PaymentRow } from "../../services/api";
import RangePicker, { rangeLabel } from "../../components/RangePicker";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";
import { countBothFromValues, ptsBothFromValues } from "../../lib/change";

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

// Which comparisons make sense for each range. Single days get the same
// choices as the Overview; longer ranges compare with the period just before.
function compareOptions(range: LandingRange): { key: CartCompare; label: string }[] {
  if (range === "today" || range === "yesterday") {
    return [
      { key: "4week_avg", label: "4-week same-weekday average" },
      { key: "last_week", label: "Same weekday last week" },
      { key: "previous", label: "Previous day" },
      { key: "last_year", label: "Same weekday last year" },
    ];
  }
  if (range === 7) {
    return [
      { key: "previous", label: "Previous 7 days" },
      { key: "4weeks_ago", label: "Same 7 days last month" },
      { key: "last_year", label: "Same 7 days last year" },
    ];
  }
  return [
    { key: "previous", label: `Previous ${range} days` },
    { key: "last_year", label: `Same ${range} days last year` },
  ];
}

type Better = "up" | "down" | null; // which direction is good; null = neutral

// Small change chip: "pts" for rates/shares, "pct" for counts and money.
function Delta({ cur, prev, kind, better = "up", className = "" }: {
  cur: number | null | undefined;
  prev: number | null | undefined;
  kind: "pts" | "pct";
  better?: Better;
  className?: string;
}) {
  if (cur == null || prev == null) return null;
  let diff: number;
  let text: string;
  if (kind === "pts") {
    diff = Math.round((cur - prev) * 10) / 10;
    text = ptsBothFromValues(cur, prev) ?? "";
  } else {
    if (prev === 0) return null;
    diff = Math.round(((cur - prev) / prev) * 1000) / 10;
    text = countBothFromValues(cur, prev) ?? "";
  }
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "";
  const good = diff === 0 || better === null ? null : (diff > 0) === (better === "up");
  const tone = good === null ? "text-slate-500 bg-slate-100" : good ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50";
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone} ${className}`}>
      {arrow && <span className="text-[9px]">{arrow}</span>}
      {text}
    </span>
  );
}

function PaymentTable({ rows, label, avg, prevRows, counts }: {
  rows: PaymentRow[];
  label: string;
  avg: number | null;
  prevRows?: PaymentRow[] | null;
  counts: boolean;
}) {
  const prev = new Map((prevRows ?? []).map((r) => [r.label, r]));
  const cmp = prevRows != null;
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
          const p = prev.get(r.label);
          return (
            <tr key={r.label} className="border-b border-slate-50 last:border-0">
              <td className="py-2.5 pr-4 font-medium capitalize text-slate-800">{r.label}</td>
              <td className="py-2.5 pr-4 text-right text-slate-600">
                {r.share_of_payments == null ? "—" : `${r.share_of_payments}%`}
                {cmp && <Delta cur={r.share_of_payments} prev={p?.share_of_payments ?? 0} kind="pts" better={null} className="ml-2" />}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                {r.attempts.toLocaleString()}
                {cmp && counts && <Delta cur={r.attempts} prev={p?.attempts} kind="pct" better={null} className="ml-2" />}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                {r.failed_attempts.toLocaleString()}
                {cmp && counts && <Delta cur={r.failed_attempts} prev={p?.failed_attempts} kind="pct" better="down" className="ml-2" />}
              </td>
              <td className={`py-2.5 text-right font-semibold ${bad ? "text-red-600" : "text-slate-800"}`}>
                {r.authorization_rate == null ? "—" : `${r.authorization_rate}%`}
                {cmp && <Delta cur={r.authorization_rate} prev={p?.authorization_rate} kind="pts" className="ml-2" />}
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
  const [compareMode, setCompareMode] = useState<CartCompare>("previous");
  const [data, setData] = useState<CartExtrasData | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.summary().catch(() => null), api.cartExtras(range, threshold, compareMode)])
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
  }, [threshold, range, compareMode]);

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
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Compare to</span>
          {(() => {
            const opts = compareOptions(range);
            return (
              <select
                value={opts.some((o) => o.key === compareMode) ? compareMode : opts[0].key}
                onChange={(e) => {
                  setData(null);
                  setCompareMode(e.target.value as CartCompare);
                }}
                className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none"
              >
                {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            );
          })()}
        </div>
        <RangePicker
          value={range}
          onChange={(r) => {
            setData(null); // never show the old range's numbers under the new button
            const opts = compareOptions(r);
            if (!opts.some((o) => o.key === compareMode)) setCompareMode(opts[0].key);
            setRange(r);
          }}
        />
      </div>
    </div>
  );

  if (error) return <div className="space-y-4">{header}<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div></div>;
  if (!data) return <div className="space-y-4">{header}<p className="text-sm text-slate-400">Loading {rangeLabel(range)} from Shopify…</p></div>;

  const ov = data.order_values;
  const ip = data.items_per_order;
  const p = data.payments;
  const cmp = data.comparison && !data.comparison.error ? data.comparison : null;
  const cp = cmp?.payments ?? null;
  const counts = cmp?.payment_counts_comparable !== false;
  const cov = cmp?.order_values;
  const cip = cmp?.items_per_order;
  const vsLine = cmp?.label ? (
    <span className="text-slate-400"> · compared with <b className="font-semibold text-slate-600">{cmp.label}</b></span>
  ) : data.comparison?.error ? <span className="text-amber-700"> · comparison not available right now</span> : null;
  // Order value / basket comparisons need our synced orders for the baseline dates.
  const ordersVsLine = cmp?.orders_note ? <span className="text-amber-700"> · {cmp.orders_note}</span> : vsLine;

  return (
    <div className="space-y-6">
      {header}
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-1 flex items-center gap-2">
          <CreditCard className="text-blue-500" size={20} />
          <h3 className="font-bold text-slate-900">Payment methods &amp; failed payments<InfoTip text={HELP.payments} /></h3>
        </div>
        <p className="mb-4 text-xs text-slate-500">{data.window_label}{vsLine}</p>
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
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-2xl font-bold text-slate-900">{p.authorization_rate == null ? "—" : `${p.authorization_rate}%`}</p>
                  {cp && <Delta cur={p.authorization_rate} prev={cp.authorization_rate} kind="pts" />}
                </div>
                <p className="cro-note mt-1 text-xs text-slate-400">{p.successful.toLocaleString()} of {p.attempts.toLocaleString()} purchase attempts</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs text-slate-500">Failed payment attempts</p>
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-2xl font-bold text-slate-900">{p.failed_attempts.toLocaleString()}</p>
                  {cp && counts && <Delta cur={p.failed_attempts} prev={cp.failed_attempts} kind="pct" better="down" />}
                </div>
                <p className="cro-note mt-1 text-xs text-slate-400">includes retries by the same customer</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs text-slate-500">Most used method</p>
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-2xl font-bold capitalize text-slate-900">{p.methods[0]?.label ?? "—"}</p>
                  {cp && p.methods[0] && (
                    <span className="text-xs text-slate-500">
                      {p.methods[0].share_of_payments}%{" "}
                      <Delta cur={p.methods[0].share_of_payments} prev={cp.methods.find((m) => m.label === p.methods[0].label)?.share_of_payments ?? 0} kind="pts" better={null} />
                    </span>
                  )}
                </div>
                <p className="cro-note mt-1 text-xs text-slate-400">{p.methods[0]?.share_of_payments ?? "—"}% of successful payments</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <PaymentTable rows={p.methods} label="Method" avg={p.authorization_rate} prevRows={cp?.methods} counts={counts} />
            </div>
            {p.wallets.length > 0 && (
              <div className="mt-5 overflow-x-auto">
                <PaymentTable rows={p.wallets} label="Wallet (Shop Pay, Apple Pay…)" avg={p.authorization_rate} prevRows={cp?.wallets} counts={counts} />
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
              <p className="text-xs text-slate-500">{data.window_label}{ordersVsLine}</p>
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
            <div className="mt-2 flex items-center gap-2">
              <p className="text-2xl font-bold text-slate-900">{ov.average == null ? "—" : formatMoney(ov.average, currency)}</p>
              {cov && <Delta cur={ov.average} prev={cov.average} kind="pct" />}
            </div>
            <p className="cro-note mt-1 text-xs text-slate-400">median {ov.median == null ? "—" : formatMoney(ov.median, currency)} · {ov.orders.toLocaleString()} orders</p>
          </div>
          <div className={`rounded-xl border p-4 ${ov.threshold ? "border-amber-200 bg-amber-50" : ""}`}>
            <p className="text-xs text-slate-500">Orders just below free shipping</p>
            <div className="mt-2 flex items-center gap-2">
              <p className="text-2xl font-bold text-slate-900">{ov.near_threshold_share == null ? "—" : `${ov.near_threshold_share}%`}</p>
              {cov && <Delta cur={ov.near_threshold_share} prev={cov.near_threshold_share} kind="pts" better="down" />}
            </div>
            <p className="cro-note mt-1 text-xs text-slate-400">
              {ov.threshold
                ? `${ov.near_threshold_orders} orders between ${formatMoney(ov.near_threshold_from ?? 0, currency)} and ${formatMoney(ov.threshold, currency)}`
                : "Enter your free-shipping amount above"}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-slate-500">Orders that qualified</p>
            <div className="mt-2 flex items-center gap-2">
              <p className="text-2xl font-bold text-slate-900">{ov.at_or_above_threshold_share == null ? "—" : `${ov.at_or_above_threshold_share}%`}</p>
              {cov && <Delta cur={ov.at_or_above_threshold_share} prev={cov.at_or_above_threshold_share} kind="pts" />}
            </div>
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
            <p className="text-xs text-slate-500">{data.window_label}{ordersVsLine}</p>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500">Average items per order</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-2xl font-bold text-slate-900">{ip.average_items ?? "—"}</p>
                {cip && <Delta cur={ip.average_items} prev={cip.average_items} kind="pct" />}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500">Single-item orders</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-2xl font-bold text-slate-900">{ip.single_item_share == null ? "—" : `${ip.single_item_share}%`}</p>
                {cip && <Delta cur={ip.single_item_share} prev={cip.single_item_share} kind="pts" better="down" />}
              </div>
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
