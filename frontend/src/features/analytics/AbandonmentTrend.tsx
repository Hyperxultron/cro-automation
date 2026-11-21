import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import EChart, { FONT, tipBase, useOceanTheme } from "../../components/EChart";
import InfoTip from "../../components/InfoTip";
import { api, type FunnelTrendDay } from "../../services/api";
import { ptsBothFromValues } from "../../lib/change";

// Cart + checkout abandonment over time (checklist section 6, P1: "with trend").
// Solid = this period, dashed = the same number of days just before.
// Lower is better, so a fall is green and a rise is red.

type Range = 7 | 14 | 30;
const short = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const nice = (iso?: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "—");

const weighted = (rows: FunnelTrendDay[], kind: "cart" | "checkout") => {
    const den = rows.reduce((s, r) => s + (kind === "cart" ? r.added_to_cart : r.reached_checkout), 0);
    const bought = rows.reduce((s, r) => s + r.completed_checkout, 0);
    return den ? Math.round(((den - bought) / den) * 1000) / 10 : null;
};

function Pts({ cur, prev }: { cur: number | null; prev: number | null }) {
    if (cur == null || prev == null) return null;
    const d = Math.round((cur - prev) * 10) / 10;
    const good = d <= 0;
    return (
        <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${d === 0 ? "bg-slate-100 text-slate-500" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {d > 0 ? "▲ " : d < 0 ? "▼ " : ""}{ptsBothFromValues(cur, prev)}
        </span>
    );
}

export default function AbandonmentTrend() {
    const t = useOceanTheme();
    const [days, setDays] = useState<Range>(14);
    const [rows, setRows] = useState<FunnelTrendDay[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        setLoading(true);
        setError(null);
        api.funnelTrend(days * 2)
            .then((r) => live && setRows(r.trend))
            .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the trend"))
            .finally(() => live && setLoading(false));
        return () => { live = false; };
    }, [days]);

    const split = useMemo(() => {
        if (!rows || rows.length === 0) return null;
        const cur = rows.slice(-days);
        const prev = rows.slice(0, Math.max(0, rows.length - days)).slice(-days);
        // line the previous period up day by day with the current one
        const pad = cur.length - prev.length;
        const prevAligned: (FunnelTrendDay | null)[] = [...Array(Math.max(0, pad)).fill(null), ...prev];
        return { cur, prev, prevAligned };
    }, [rows, days]);

    const option = useMemo<EChartsOption | null>(() => {
        if (!split) return null;
        const { cur, prevAligned } = split;
        const axisLabel = { color: t.muted, fontFamily: FONT, fontSize: 11 };
        const cartC = t.cat[1], chkC = t.cat[3];
        const line = (name: string, data: (number | null)[], color: string, dashed: boolean) => ({
            name, type: "line" as const, data, connectNulls: true,
            symbol: dashed ? "none" : "circle", symbolSize: 6, showSymbol: !dashed && data.length <= 31,
            lineStyle: { color: dashed ? color : color, width: dashed ? 1.5 : 2.6, type: dashed ? ([5, 4] as number[]) : ("solid" as const), opacity: dashed ? 0.55 : 1 },
            itemStyle: { color },
        });
        return {
            animationDuration: 400,
            grid: { left: 6, right: 26, top: 36, bottom: 6, containLabel: true },
            legend: {
                top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4,
                textStyle: { color: t.muted, fontFamily: FONT, fontSize: 12 },
                data: ["Cart abandonment", "Checkout abandonment"],
            },
            tooltip: {
                ...tipBase(t), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.axis } },
                formatter: (ps: unknown) => {
                    const i = (ps as { dataIndex: number }[])[0]?.dataIndex ?? 0;
                    const c = cur[i], p = prevAligned[i];
                    const v = (x: number | null | undefined) => (x == null ? "—" : `${x}%`);
                    return `<div style="font-weight:600;color:${t.text}">${nice(c?.date)}</div>`
                        + `<div style="color:${cartC}">Cart: ${v(c?.cart_abandonment_rate)}</div>`
                        + `<div style="color:${chkC}">Checkout: ${v(c?.checkout_abandonment_rate)}</div>`
                        + `<div style="color:${t.muted};margin-top:4px">${nice(p?.date)}: cart ${v(p?.cart_abandonment_rate)} · checkout ${v(p?.checkout_abandonment_rate)}</div>`;
                },
            },
            xAxis: {
                type: "category", boundaryGap: false, data: cur.map((r) => short(r.date ?? "")),
                axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel,
            },
            yAxis: {
                type: "value", scale: true,
                splitLine: { lineStyle: { color: t.grid, type: "dashed" } },
                axisLabel: { ...axisLabel, formatter: (v: number) => `${v}%` },
            },
            series: [
                line("Cart abandonment (previous)", prevAligned.map((r) => r?.cart_abandonment_rate ?? null), cartC, true),
                line("Checkout abandonment (previous)", prevAligned.map((r) => r?.checkout_abandonment_rate ?? null), chkC, true),
                line("Cart abandonment", cur.map((r) => r.cart_abandonment_rate), cartC, false),
                line("Checkout abandonment", cur.map((r) => r.checkout_abandonment_rate), chkC, false),
            ],
        };
    }, [split, t]);

    const cur = split?.cur ?? [];
    const prev = split?.prev ?? [];
    const label = cur.length ? `${short(cur[0].date ?? "")} - ${short(cur[cur.length - 1].date ?? "")}` : "";
    const prevLabel = prev.length ? `${short(prev[0].date ?? "")} - ${short(prev[prev.length - 1].date ?? "")}` : "";

    return (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold text-slate-900">
                        Abandonment Rate Trend
                        <InfoTip text="Cart abandonment = sessions that added to cart but didn't buy / sessions that added to cart. Checkout abandonment = sessions that reached checkout but didn't buy / sessions that reached checkout. Shopify Analytics, bots excluded. Lower is better. Dashed lines = the same number of days just before." />
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                        {label ? `${label} (last ${days} complete days) · dashed: ${prevLabel}` : loading ? "Loading…" : ""}
                    </p>
                </div>
                <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                    {([7, 14, 30] as Range[]).map((d) => (
                        <button
                            key={d}
                            onClick={() => setDays(d)}
                            className={`rounded-md px-2.5 py-1 font-semibold ${days === d ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                        >
                            {d} days
                        </button>
                    ))}
                </div>
            </div>

            {split && (
                <div className="mb-3 grid gap-3 sm:grid-cols-2">
                    {(["cart", "checkout"] as const).map((k) => {
                        const c = weighted(cur, k), p = weighted(prev, k);
                        return (
                            <div key={k} className="rounded-xl bg-slate-50 px-4 py-3">
                                <p className="text-xs font-medium text-slate-500">{k === "cart" ? "Cart abandonment" : "Checkout abandonment"} · {days} days</p>
                                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                                    <span className="text-xl font-bold text-slate-900">{c != null ? `${c}%` : "—"}</span>
                                    <Pts cur={c} prev={p} />
                                    <span className="text-xs text-slate-400">{p != null ? `vs ${p}% before` : ""}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {error ? (
                <p className="text-xs text-red-600">{error}</p>
            ) : option ? (
                <EChart option={option} height={260} />
            ) : (
                <p className="text-xs text-slate-400">{loading ? "Loading…" : "No trend data available."}</p>
            )}
        </section>
    );
}
