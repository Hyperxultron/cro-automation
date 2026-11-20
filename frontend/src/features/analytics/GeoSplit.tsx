import { useEffect, useState } from "react";
import InfoTip from "../../components/InfoTip";
import { api, type GeoRow, type GeoSplit } from "../../services/api";

// Conversion by country and US state (checklist section 3, P2).
type Range = "yesterday" | 7 | 28;

const tone = (v: number | null | undefined) =>
    v == null || v === 0 ? "text-slate-400" : v > 0 ? "text-emerald-600" : "text-red-600";
const signed = (v: number | null | undefined, unit: string, digits: number) =>
    v == null ? "" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;

function GeoTable({ title, rows, storeCvr }: { title: string; rows: GeoRow[] | null; storeCvr: number | null }) {
    if (rows == null) return (
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
            <p className="text-xs text-slate-400">Shopify didn't return this split.</p></div>
    );
    const max = Math.max(1, ...rows.map((r) => r.conversion_rate ?? 0));
    return (
        <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-slate-400">
                            <th className="pb-2 font-medium">Where</th>
                            <th className="pb-2 text-right font-medium">Sessions</th>
                            <th className="whitespace-nowrap pb-2 pl-4 text-right font-medium">Add to cart</th>
                            <th className="pb-2 pl-3 font-medium">Conversion</th>
                            <th className="pb-2 text-right font-medium">Purchases</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((r) => (
                            <tr key={r.label} className={r.enough_data ? "" : "opacity-60"}>
                                <td className="py-2 pr-2 font-medium text-slate-800">{r.label}</td>
                                <td className="whitespace-nowrap py-2 text-right">
                                    <span className="font-semibold text-slate-900">{r.sessions.toLocaleString()}</span>
                                    <span className="ml-1 text-xs text-slate-400">{r.share_of_sessions != null ? `${r.share_of_sessions}%` : ""}</span>
                                </td>
                                <td className="py-2 pl-4 text-right text-slate-700">{r.added_to_cart_rate != null ? `${r.added_to_cart_rate}%` : "—"}</td>
                                <td className="py-2 pl-3">
                                    <div className="flex items-center gap-2">
                                        <div className="h-1.5 w-16 shrink-0 rounded-full bg-slate-100">
                                            <div
                                                className={`h-full rounded-full ${storeCvr != null && (r.conversion_rate ?? 0) < storeCvr ? "bg-amber-400" : "bg-emerald-500"}`}
                                                style={{ width: `${((r.conversion_rate ?? 0) / max) * 100}%` }}
                                            />
                                        </div>
                                        <span className="font-semibold text-slate-900">{r.conversion_rate != null ? `${r.conversion_rate}%` : "—"}</span>
                                        {r.enough_data && (
                                            <span className={`text-xs font-semibold ${tone(r.conversion_change_pts)}`}>{signed(r.conversion_change_pts, " pts", 2)}</span>
                                        )}
                                    </div>
                                </td>
                                <td className="py-2 text-right font-semibold text-slate-900">{r.purchases.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function GeoSplitCard() {
    const [range, setRange] = useState<Range>(28);
    const [data, setData] = useState<GeoSplit | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        setLoading(true);
        setError(null);
        api.geo(range)
            .then((d) => live && setData(d))
            .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load"))
            .finally(() => live && setLoading(false));
        return () => { live = false; };
    }, [range]);

    const all = data?.countries ?? [];
    const totS = all.reduce((n, r) => n + r.sessions, 0);
    const totB = all.reduce((n, r) => n + r.purchases, 0);
    const storeCvr = totS ? Math.round((totB / totS) * 10000) / 100 : null;

    return (
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold text-slate-900">
                        Split by Country and US State
                        <InfoTip text="Sessions, add-to-cart rate and conversion by visitor location, from Shopify Analytics (bots excluded). Conversion = sessions that completed checkout / sessions. Green bar = at or above the store's conversion, amber = below. Change is vs the comparison period. Faded rows have too few sessions to judge." />
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
                <div className="grid gap-6 xl:grid-cols-2">
                    <GeoTable title="By country" rows={data.countries} storeCvr={storeCvr} />
                    <GeoTable title="By US state" rows={data.states} storeCvr={storeCvr} />
                </div>
            )}
        </section>
    );
}
