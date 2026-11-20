import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import InfoTip from "../../components/InfoTip";
import { api, formatMoney, type WhereChanged, type WhereRow } from "../../services/api";

// Overview "Where it changed" (device / channel) + "Top movers" - checklist section 2, P2.
// Colour = good or bad for the store, not up or down.

type Range = "yesterday" | 7 | 28;

const tone = (v: number | null | undefined) =>
    v == null || v === 0 ? "text-slate-400" : v > 0 ? "text-emerald-600" : "text-red-600";
const signed = (v: number | null | undefined, unit: string, digits = 1) =>
    v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;

function Table({ title, rows, showRps, currency }: { title: string; rows: WhereRow[]; showRps: boolean; currency: string | null | undefined }) {
    const shown = rows.filter((r) => r.sessions > 0 || r.previous_sessions > 0).slice(0, 6);
    return (
        <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-slate-400">
                            <th className="pb-2 font-medium">Segment</th>
                            <th className="pb-2 text-right font-medium">Sessions</th>
                            <th className="pb-2 text-right font-medium">Conversion</th>
                            {showRps && <th className="pb-2 text-right font-medium">Rev / session</th>}
                            <th className="pb-2 text-right font-medium">Purchases</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {shown.map((r) => (
                            <tr key={r.key} className={r.enough_data ? "" : "opacity-60"}>
                                <td className="py-2 pr-2 font-medium text-slate-800">{r.label}</td>
                                <td className="py-2 text-right">
                                    <span className="font-semibold text-slate-900">{r.sessions.toLocaleString()}</span>
                                    <span className={`ml-1.5 text-xs font-semibold ${tone(r.sessions_change_pct)}`}>{signed(r.sessions_change_pct, "%", 0)}</span>
                                </td>
                                <td className="py-2 text-right">
                                    <span className="font-semibold text-slate-900">{r.conversion_rate != null ? `${r.conversion_rate}%` : "—"}</span>
                                    <span className={`ml-1.5 text-xs font-semibold ${tone(r.conversion_change_pts)}`}>{signed(r.conversion_change_pts, " pts", 2)}</span>
                                </td>
                                {showRps && (
                                    <td className="py-2 text-right">
                                        <span className="font-semibold text-slate-900">{r.revenue_per_session != null ? formatMoney(r.revenue_per_session, currency, 2) : "—"}</span>
                                        <span className={`ml-1.5 text-xs font-semibold ${tone(r.revenue_per_session_change_pct)}`}>{signed(r.revenue_per_session_change_pct, "%", 0)}</span>
                                    </td>
                                )}
                                <td className="py-2 text-right">
                                    <span className="font-semibold text-slate-900">{r.purchases.toLocaleString()}</span>
                                    <span className={`ml-1.5 text-xs font-semibold ${tone(r.purchases_change)}`}>{r.purchases_change > 0 ? "+" : ""}{r.purchases_change}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function WhereChangedCard({ currency }: { currency: string | null | undefined }) {
    const [range, setRange] = useState<Range>("yesterday");
    const [data, setData] = useState<WhereChanged | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        setLoading(true);
        setError(null);
        api.whereChanged(range)
            .then((d) => live && setData(d))
            .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load"))
            .finally(() => live && setLoading(false));
        return () => { live = false; };
    }, [range]);

    return (
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold text-slate-900">
                        Where It Changed
                        <InfoTip text="Sessions, conversion and purchases by device and by channel, from Shopify Analytics (bots excluded). Each change in purchases is split into a traffic part (more or fewer visits) and a conversion part (visits buying more or less often). Top movers are the three biggest of those. Faded rows have too few sessions to judge." />
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                        {data ? `${data.window_label} · vs ${data.compare_label}` : loading ? "Loading…" : ""}
                    </p>
                </div>
                <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                    {([["yesterday", "Yesterday"], [7, "7 days"], [28, "28 days"]] as [Range, string][]).map(([k, l]) => (
                        <button
                            key={String(k)}
                            onClick={() => setRange(k)}
                            className={`rounded-md px-2.5 py-1 font-semibold ${range === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                        >
                            {l}
                        </button>
                    ))}
                </div>
            </div>

            {error ? (
                <p className="text-xs text-red-600">{error}</p>
            ) : !data ? (
                <p className="text-xs text-slate-400">Loading…</p>
            ) : (
                <>
                    <div className="mb-5 rounded-xl bg-slate-50 p-4">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Top movers</p>
                        {data.too_early ? (
                            <p className="text-sm text-slate-500">Too early to compare: fewer than 500 sessions in this period.</p>
                        ) : data.movers.length === 0 ? (
                            <p className="text-sm text-slate-500">No big moves: every device and channel is close to where it was.</p>
                        ) : (
                            <ol className="space-y-2">
                                {data.movers.map((m, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                                        <span className={`mt-0.5 rounded-md p-0.5 ${m.good ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                                            {m.good ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                        </span>
                                        <span>{m.text}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                    <div className="grid gap-6 xl:grid-cols-2">
                        <Table title="By device" rows={data.device} showRps={false} currency={currency} />
                        <Table title="By channel" rows={data.channel} showRps currency={currency} />
                    </div>
                </>
            )}
        </section>
    );
}
