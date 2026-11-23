import { useEffect, useState } from "react";
import InfoTip from "../../components/InfoTip";
import { api, type Grid, type GridCell, type LandingGrids as GridsData, type LandingRange, type PickedDates } from "../../services/api";

// Landing page x source, and device x page type (checklist section 3, P2).
type Metric = "conversion_rate" | "added_to_cart_rate" | "bounce_rate";
const METRICS: [Metric, string][] = [["conversion_rate", "Conversion"], ["added_to_cart_rate", "Add to cart"], ["bounce_rate", "Bounce"]];
const nice = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function overall(g: Grid, m: Metric): number | null {
    let s = 0, w = 0;
    g.column_totals.forEach((c) => { if (c[m] != null) { s += c.sessions; w += (c[m] as number) * c.sessions; } });
    return s ? w / s : null;
}

function cellTone(v: number | null, base: number | null, m: Metric, ok: boolean) {
    if (!ok || v == null || base == null || base === 0) return "bg-slate-50 text-slate-400";
    const rel = (v - base) / base;
    const good = m === "bounce_rate" ? rel < 0 : rel > 0;
    const strong = Math.abs(rel) >= 0.25;
    if (Math.abs(rel) < 0.1) return "bg-white text-slate-800";
    if (good) return strong ? "bg-emerald-100 text-emerald-900" : "bg-emerald-50 text-emerald-800";
    return strong ? "bg-red-100 text-red-900" : "bg-red-50 text-red-800";
}

function GridTable({ g, metric, rowHead, rowLabel }: { g: Grid; metric: Metric; rowHead: string; rowLabel: (s: string) => string }) {
    const base = overall(g, metric);
    const Cell = ({ c }: { c: GridCell }) => (
        <td className="p-1">
            <div className={`rounded-lg px-2 py-1.5 text-center ${cellTone(c[metric], base, metric, c.enough_data)}`} title={`${c.sessions.toLocaleString()} sessions`}>
                <div className="text-sm font-semibold">{c[metric] != null && c.sessions ? `${c[metric]}%` : "—"}</div>
                <div className="text-[10px] opacity-70">{c.sessions.toLocaleString()}</div>
            </div>
        </td>
    );
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                <thead>
                    <tr className="text-xs text-slate-400">
                        <th className="pb-2 pr-3 text-left font-medium">{rowHead}</th>
                        {g.columns.map((c) => <th key={c} className="pb-2 text-center font-medium">{nice(c)}</th>)}
                        <th className="pb-2 text-center font-semibold text-slate-500">All</th>
                    </tr>
                </thead>
                <tbody>
                    {g.rows.map((r, i) => (
                        <tr key={r}>
                            <td className="max-w-[260px] truncate py-1 pr-3 font-medium text-slate-700" title={r}>{rowLabel(r)}</td>
                            {g.cells[i].map((c, j) => <Cell key={j} c={c} />)}
                            <Cell c={g.row_totals[i]} />
                        </tr>
                    ))}
                    <tr>
                        <td className="py-1 pr-3 font-semibold text-slate-500">All</td>
                        {g.column_totals.map((c, j) => <Cell key={j} c={c} />)}
                        <td />
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

export default function LandingGrids({ range, dates = null }: { range: LandingRange; dates?: PickedDates | null }) {
    const [data, setData] = useState<GridsData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [m1, setM1] = useState<Metric>("conversion_rate");
    const [m2, setM2] = useState<Metric>("conversion_rate");

    useEffect(() => {
        let live = true;
        setData(null);
        setError(null);
        api.landingGrids(range, dates)
            .then((d) => live && setData(d))
            .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load"));
        return () => { live = false; };
    }, [range, dates?.start, dates?.end]);

    const picker = (m: Metric, set: (m: Metric) => void) => (
        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {METRICS.map(([k, l]) => (
                <button key={k} onClick={() => set(k)} className={`rounded-md px-2.5 py-1 font-semibold ${m === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{l}</button>
            ))}
        </div>
    );
    const help = "Each cell = that metric for visits in that row and column, with its sessions underneath. Green = better than the whole grid's average, red = worse (for bounce, lower is better). Grey cells have too few sessions to judge. Shopify Analytics, bots excluded.";

    const section = (title: string, g: Grid | null | undefined, m: Metric, set: (m: Metric) => void, rowHead: string, rowLabel: (s: string) => string) => (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold text-slate-900">{title}<InfoTip text={help} /></h3>
                    <p className="mt-1 text-xs text-slate-400">{data?.window_label ?? "Loading…"}</p>
                </div>
                {picker(m, set)}
            </div>
            {error ? <p className="text-xs text-red-600">{error}</p>
                : !data ? <p className="text-xs text-slate-400">Loading…</p>
                : !g ? <p className="text-xs text-slate-400">Shopify didn't return this split.</p>
                : <GridTable g={g} metric={m} rowHead={rowHead} rowLabel={rowLabel} />}
        </section>
    );

    return (
        <>
            {section("Landing Page × Traffic Source", data?.page_source, m1, setM1, "Landing page", (s) => s)}
            {section("Device × Page Type", data?.type_device, m2, setM2, "Landed on", nice)}
        </>
    );
}
