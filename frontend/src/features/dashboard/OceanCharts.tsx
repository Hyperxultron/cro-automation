import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import EChart, { FONT, tipBase, useOceanTheme } from "../../components/EChart";
import InfoTip from "../../components/InfoTip";
import { api, formatMoney, type BuyHeatmap, type SegmentSplit } from "../../services/api";

const hexA = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const niceDate = (iso: string | null) =>
    iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "—";

// ---------------------------------------------------------------------------
// Total sales over time: area (or bars) for this period, dashed line for the
// period before, drag-to-zoom slider, peak + average markers, Change Log dots.
// ---------------------------------------------------------------------------
export type SalesPoint = { day: string; curDate: string; prevDate: string | null; current: number | null; previous: number | null };

export function SalesOverTimeChart({ rows, markers, currency, mode }: {
    rows: SalesPoint[];
    markers: { id: number | string; label: string }[];
    currency: string | null | undefined;
    mode: "area" | "bars";
}) {
    const t = useOceanTheme();
    const option = useMemo<EChartsOption>(() => {
        const money = (v: number) => formatMoney(v, currency);
        const short = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`);
        const axisLabel = { color: t.muted, fontFamily: FONT, fontSize: 11 };
        return {
            animationDuration: 500,
            grid: { left: 8, right: 30, top: 32, bottom: 56, containLabel: true },
            tooltip: {
                ...tipBase(t),
                trigger: "axis",
                axisPointer: { type: "line", lineStyle: { color: t.axis } },
                formatter: (ps: unknown) => {
                    const list = ps as { dataIndex: number }[];
                    const r = rows[list[0]?.dataIndex ?? 0];
                    if (!r) return "";
                    const val = (v: number | null) => (v === null ? "no data" : money(v));
                    return `<div style="font-weight:600;color:${t.main}">${niceDate(r.curDate)}: ${val(r.current)}</div>`
                        + `<div style="color:${t.muted};margin-top:2px">${niceDate(r.prevDate)}: ${val(r.previous)}</div>`;
                },
            },
            xAxis: {
                type: "category",
                data: rows.map((r) => r.day),
                boundaryGap: mode === "bars",
                axisLine: { lineStyle: { color: t.axis } },
                axisTick: { show: false },
                axisLabel,
            },
            yAxis: {
                type: "value",
                splitLine: { lineStyle: { color: t.grid, type: "dashed" } },
                axisLabel: { ...axisLabel, formatter: (v: number) => short(v) },
            },
            dataZoom: [
                { type: "inside", start: 0, end: 100 },
                {
                    type: "slider", height: 18, bottom: 8, start: 0, end: 100,
                    borderColor: t.axis, fillerColor: hexA(t.main, 0.12), backgroundColor: "transparent",
                    dataBackground: { lineStyle: { color: t.prev }, areaStyle: { color: hexA(t.prev, 0.15) } },
                    selectedDataBackground: { lineStyle: { color: t.main }, areaStyle: { color: hexA(t.main, 0.2) } },
                    handleStyle: { color: t.surface, borderColor: t.main },
                    moveHandleStyle: { color: t.main },
                    textStyle: { color: t.muted, fontFamily: FONT, fontSize: 10 },
                },
            ],
            series: [
                {
                    name: "Previous period",
                    type: "line",
                    data: rows.map((r) => r.previous),
                    symbol: "none",
                    lineStyle: { color: t.prev, width: 1.6, type: [5, 4] },
                    z: 1,
                },
                {
                    name: "This period",
                    type: mode === "bars" ? "bar" : "line",
                    data: rows.map((r) => r.current),
                    barMaxWidth: 26,
                    itemStyle: { color: t.main, borderRadius: mode === "bars" ? [5, 5, 0, 0] : 0 },
                    lineStyle: { color: t.main, width: 2.6 },
                    symbol: "circle",
                    symbolSize: 6,
                    showSymbol: rows.length <= 31,
                    areaStyle: mode === "area"
                        ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexA(t.main, 0.32) }, { offset: 1, color: hexA(t.main, 0.02) }] } }
                        : undefined,
                    markPoint: {
                        symbol: "roundRect", symbolSize: [58, 22], symbolOffset: [0, -18],
                        data: [{ type: "max", name: "Peak" }],
                        label: { formatter: (p: unknown) => short((p as { value: number }).value), fontSize: 11, fontWeight: 600, color: "#fff", fontFamily: FONT },
                        itemStyle: { color: t.main },
                    },
                    markLine: {
                        symbol: "none", silent: true,
                        data: [
                            { type: "average", name: "Avg" },
                            ...markers.map((m) => ({ xAxis: m.label, name: "Change" })),
                        ],
                        lineStyle: { color: t.muted, type: [2, 4], width: 1 },
                        label: {
                            color: t.muted, fontSize: 11, fontFamily: FONT,
                            formatter: (p: unknown) => {
                                const q = p as { name: string; value: number };
                                return q.name === "Avg" ? `Avg ${short(q.value)}` : "●";
                            },
                            position: "insideEndTop",
                        },
                    },
                    z: 2,
                },
            ],
        };
    }, [rows, markers, currency, mode, t]);
    return <EChart option={option} height={300} />;
}

// ---------------------------------------------------------------------------
// When do people buy? Conversion rate by weekday x hour (store time).
// ---------------------------------------------------------------------------
export function BuyHeatmapCard() {
    const t = useOceanTheme();
    const [data, setData] = useState<BuyHeatmap | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        api.buyHeatmap(28).then(setData).catch((e) => setErr(e instanceof Error ? e.message : "unavailable"));
    }, []);

    const option = useMemo<EChartsOption | null>(() => {
        if (!data) return null;
        const byOrders = data.metric === "orders";
        // Fallback mode: colour = number of orders placed in that hour.
        const valueOf = (c: BuyHeatmap["cells"][number]) => (byOrders ? c.orders : c.cvr);
        const vals = data.cells.map(valueOf).filter((v): v is number => v !== null);
        const max = vals.length ? Math.max(...vals) : 1;
        const hours = Array.from({ length: 24 }, (_, h) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`));
        return {
            grid: { left: 4, right: 8, top: 8, bottom: 52, containLabel: true },
            tooltip: {
                ...tipBase(t),
                formatter: (p: unknown) => {
                    const v = (p as { value: [number, number, number | null, number, number] }).value;
                    const [h, w, cvr, s, o] = v;
                    const head = `<div style="font-weight:600">${data.weekdays[w]} ${hours[h]}-${hours[(h + 1) % 24]}</div>`;
                    if (byOrders) return head + `${o} orders placed in this hour`;
                    return head
                        + (cvr === null ? `${s.toLocaleString()} visits (too few to judge)` : `${cvr}% conversion<br><span style="color:${t.muted}">${o} orders from ${s.toLocaleString()} visits</span>`);
                },
            },
            xAxis: { type: "category", data: hours, splitArea: { show: false }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 10, fontFamily: FONT, interval: 1 } },
            yAxis: { type: "category", data: data.weekdays, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11, fontFamily: FONT } },
            visualMap: {
                min: 0, max: Math.ceil(max), calculable: true, orient: "horizontal", left: "center", bottom: 0,
                dimension: 2, itemHeight: 140, itemWidth: 12,
                inRange: { color: t.seq }, outOfRange: { color: t.grid },
                textStyle: { color: t.muted, fontSize: 10, fontFamily: FONT },
                formatter: (v: unknown) => (byOrders ? `${Math.round(Number(v))}` : `${Number(v).toFixed(1)}%`),
            },
            series: [{
                type: "heatmap",
                data: data.cells.map((c) => [c.hour, c.weekday, valueOf(c), c.sessions, c.orders]),
                itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
                emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } },
            }],
        };
    }, [data, t]);

    const byOrders = data?.metric === "orders";
    const best = byOrders
        ? [...(data?.cells ?? [])].sort((a, b) => b.orders - a.orders)[0]
        : data?.cells.filter((c) => c.cvr !== null).sort((a, b) => (b.cvr ?? 0) - (a.cvr ?? 0))[0];
    return (
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="font-bold text-slate-900">When do people buy?<InfoTip text="Conversion rate (orders ÷ visits, bots excluded) for each weekday and hour, store time, over the last 28 complete days. Darker = more of the visitors in that hour bought. Grey = fewer than 20 visits, too few to judge. Drag the handles on the colour scale to spotlight hours." /></h3>
            <p className="mt-1 text-xs text-slate-500">{data ? `${byOrders ? "Orders by hour · " : ""}${data.window_label}` : err ? "" : "Loading…"}</p>
            {byOrders && best && best.orders > 0 && (
                <p className="mt-2 text-sm text-slate-600">
                    Busiest hour: <b className="text-slate-900">{data?.weekdays[best.weekday]} around {best.hour}:00</b> ({best.orders} orders over {data?.days} days).
                </p>
            )}
            {byOrders && data?.note && <p className="cro-note mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.note}</p>}
            {!byOrders && best && data?.average_cvr != null && (
                <p className="mt-2 text-sm text-slate-600">
                    Best hour: <b className="text-slate-900">{data.weekdays[best.weekday]} around {best.hour}:00</b> ({best.cvr}% vs {data.average_cvr}% average).
                </p>
            )}
            {err && <p className="mt-3 text-xs text-slate-400">Hourly data isn't available from Shopify right now.</p>}
            {option && <EChart option={option} height={290} />}
        </section>
    );
}

// ---------------------------------------------------------------------------
// Traffic sources donut: share of visits per channel, centre label follows hover.
// ---------------------------------------------------------------------------
export function TrafficSourcesCard() {
    const t = useOceanTheme();
    const [data, setData] = useState<SegmentSplit | null>(null);
    const [err, setErr] = useState(false);
    const [hover, setHover] = useState<number | null>(null);
    useEffect(() => {
        api.segments("channel", 28).then(setData).catch(() => setErr(true));
    }, []);

    const rows = useMemo(() => {
        if (!data) return [];
        const sorted = [...data.rows].sort((a, b) => b.sessions - a.sessions);
        const top = sorted.slice(0, 5);
        const rest = sorted.slice(5);
        if (rest.length) {
            const s = rest.reduce((n, r) => n + r.sessions, 0);
            const o = rest.reduce((n, r) => n + r.orders, 0);
            top.push({ ...rest[0], label: "Other", sessions: s, orders: o, conversion_rate: s ? Math.round((o / s) * 10000) / 100 : null });
        }
        return top;
    }, [data]);
    const total = rows.reduce((n, r) => n + r.sessions, 0);
    const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const option = useMemo<EChartsOption>(() => ({
        color: t.cat,
        tooltip: {
            ...tipBase(t),
            trigger: "item",
            formatter: (p: unknown) => {
                const r = rows[(p as { dataIndex: number }).dataIndex];
                if (!r) return "";
                return `<div style="font-weight:600">${label(r.label)}</div>${(r.sessions / (total || 1) * 100).toFixed(1)}% of visits · ${r.sessions.toLocaleString()}`
                    + `<br><span style="color:${t.muted}">${r.conversion_rate ?? "—"}% conversion</span>`;
            },
        },
        legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: t.muted, fontFamily: FONT, fontSize: 11 } },
        series: [{
            type: "pie",
            radius: ["52%", "76%"],
            center: ["50%", "44%"],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: t.surface, borderWidth: 3, borderRadius: 6 },
            label: { show: false },
            emphasis: { scale: true, scaleSize: 6 },
            data: rows.map((r) => ({ name: label(r.label), value: r.sessions })),
        }],
    }), [rows, total, t]);

    const onEvents = useMemo(() => ({
        mouseover: (p: unknown) => setHover((p as { dataIndex: number }).dataIndex),
        mouseout: () => setHover(null),
    }), []);
    const focus = hover !== null ? rows[hover] : null;

    return (
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="font-bold text-slate-900">Traffic sources<InfoTip text="Where visits came from (Shopify's referrer type, bots excluded) over the last 28 complete days, and how many of each converted. Hover a slice for its conversion rate; click a legend item to hide it." /></h3>
            <p className="mt-1 text-xs text-slate-500">{data ? `Share of visits · last ${data.days} complete days` : err ? "" : "Loading…"}</p>
            {err && <p className="mt-3 text-xs text-slate-400">Traffic data isn't available from Shopify right now.</p>}
            {rows.length > 0 && (
                <div className="relative">
                    <EChart option={option} height={290} onEvents={onEvents} />
                    <div className="pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 text-center">
                        <p className="text-xl font-semibold text-slate-900">
                            {focus ? `${((focus.sessions / (total || 1)) * 100).toFixed(1)}%` : total.toLocaleString()}
                        </p>
                        <p className="text-[11px] text-slate-500">{focus ? `${label(focus.label)} · ${focus.conversion_rate ?? "—"}% conv.` : "visits"}</p>
                    </div>
                </div>
            )}
        </section>
    );
}
