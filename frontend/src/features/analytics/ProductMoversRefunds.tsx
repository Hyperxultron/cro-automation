import { useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import InfoTip from "../../components/InfoTip";
import { formatMoney, type ProductAnalyticsData, type ProductMover } from "../../services/api";

// Products: 28 vs prior 28 movers + refunds per product (checklist section 4, P2).

function MoverList({ title, rows, up, currency }: { title: string; rows: ProductMover[]; up: boolean; currency: string | null }) {
    return (
        <div className="min-w-0">
            <p className={`mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${up ? "text-emerald-600" : "text-red-600"}`}>
                {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{title}
            </p>
            {rows.length === 0 ? (
                <p className="text-xs text-slate-400">No product moved by $100 or more.</p>
            ) : (
                <ul className="divide-y divide-slate-100">
                    {rows.map((m) => (
                        <li key={m.name} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800" title={m.name}>{m.name}</p>
                                <p className="text-xs text-slate-400">
                                    {formatMoney(m.prior_revenue, currency)} → {formatMoney(m.revenue, currency)} · {m.prior_quantity} → {m.quantity} sold · {m.category}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className={`text-sm font-bold ${up ? "text-emerald-600" : "text-red-600"}`}>{m.change > 0 ? "+" : "-"}{formatMoney(Math.abs(m.change), currency)}</p>
                                <p className="text-xs text-slate-400">
                                    {m.change_pct == null ? "new" : m.prior_revenue && m.revenue === 0 ? "no sales now" : `${m.change_pct > 0 ? "+" : ""}${m.change_pct}%`}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function ProductMoversRefunds({ data, currency }: { data: ProductAnalyticsData | null; currency: string | null }) {
    const [refundSort, setRefundSort] = useState<"by_rate" | "by_amount">("by_rate");
    if (!data) return null;
    const rf = data.refunds;
    const rows = rf ? rf[refundSort] : [];
    const store = rf?.store_refund_rate ?? null;
    return (
        <>
            {data.movers && (
                <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
                    <h3 className="font-bold text-slate-900">
                        Biggest Movers
                        <InfoTip text="Products whose sales changed the most in money, last 28 complete days vs the 28 days before. Ranked by dollars, not %, so a big product slipping shows above a small one doubling. Only changes of $100 or more are listed." />
                    </h3>
                    <p className="mb-4 mt-1 text-xs text-slate-400">{data.window_label} · vs {data.prior_window_label}</p>
                    <div className="grid gap-6 xl:grid-cols-2">
                        <MoverList title="Selling more" rows={data.movers.up} up currency={currency} />
                        <MoverList title="Selling less" rows={data.movers.down} up={false} currency={currency} />
                    </div>
                </section>
            )}

            <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="font-bold text-slate-900">
                            Refunds by Product
                            <InfoTip text="Refunded = Shopify's sales reversals (returns and refunds) for the product. Refund rate = refunded / the product's gross sales. Shopify counts a refund on the day it's made, so this is money refunded in these 28 days. Only products with $300+ gross sales are listed, so one return on a tiny seller doesn't top the list." />
                        </h3>
                        <p className="mt-1 text-xs text-slate-400">{data.window_label}</p>
                    </div>
                    {rf && (
                        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                            {([["by_rate", "Highest rate"], ["by_amount", "Most refunded"]] as const).map(([k, l]) => (
                                <button key={k} onClick={() => setRefundSort(k)} className={`rounded-md px-2.5 py-1 font-semibold ${refundSort === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{l}</button>
                            ))}
                        </div>
                    )}
                </div>
                {!rf ? (
                    <p className="text-xs text-slate-400">Needs Shopify's per-product sales report, which didn't answer right now.</p>
                ) : (
                    <>
                        <div className="mb-4 flex flex-wrap gap-3">
                            <div className="rounded-xl bg-slate-50 px-4 py-3">
                                <p className="text-xs text-slate-500">Store refund rate</p>
                                <p className="text-xl font-bold text-slate-900">{store != null ? `${store}%` : "—"}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 px-4 py-3">
                                <p className="text-xs text-slate-500">Refunded in total</p>
                                <p className="text-xl font-bold text-slate-900">{formatMoney(rf.total_refunded, currency)}</p>
                            </div>
                        </div>
                        {rows.length === 0 ? (
                            <p className="text-xs text-slate-400">No refunds on products with $300+ sales in this window.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b text-left text-xs text-slate-400">
                                            <th className="py-2 pr-4 font-medium">Product</th>
                                            <th className="py-2 pr-4 text-right font-medium">Gross sales</th>
                                            <th className="py-2 pr-4 text-right font-medium">Refunded</th>
                                            <th className="py-2 text-right font-medium">Refund rate</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr key={r.name} className="border-b border-slate-50 last:border-0">
                                                <td className="max-w-[340px] py-2.5 pr-4">
                                                    <p className="truncate font-medium text-slate-800" title={r.name}>{r.name}</p>
                                                    <p className="text-xs text-slate-400">{r.category}</p>
                                                </td>
                                                <td className="py-2.5 pr-4 text-right text-slate-600">{formatMoney(r.gross_sales, currency)}</td>
                                                <td className="py-2.5 pr-4 text-right text-slate-800">{formatMoney(r.refunded, currency)}</td>
                                                <td className="py-2.5 text-right">
                                                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${store != null && r.refund_rate > store * 1.5 ? "bg-red-50 text-red-700" : store != null && r.refund_rate > store ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                                                        {r.refund_rate}%
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </section>
        </>
    );
}
