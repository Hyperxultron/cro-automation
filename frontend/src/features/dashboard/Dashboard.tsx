
import { useCallback, useEffect, useState } from "react";
import {
    api, formatMoney, timeAgo,
    type AlarmRuleItem, type ChangeLogEntry, type CvrDay, type DashboardSummary, type FunnelCompare, type OrderHealth, type OrderHealthRange, type Overview, type OrdersTrendDay, type SalesBreakdown, type SalesTrend, type TopProduct, type DeviceFunnel, type KpiRange, type KpiTotals
} from "../../services/api";
import ChangeLog from "../changelog/ChangeLog";
import AlarmRules from "../alarms/AlarmRules";
import AlertHistory from "../alarms/AlertHistory";
import SettingsPage from "../settings/Settings";
import StoreIntegration from "../store/StoreIntegration";
import { BuyHeatmapCard, OverviewTrendsRow, SalesOverTimeChart, TrafficSourcesCard } from "./OceanCharts";
import CroRecommendations from "../recommendations/CroRecommendations";
import WhereChangedCard from "./WhereChanged";
import Experiments, { type ExperimentPrefill } from "../experiments/Experiments";
import DeeperAnalyses from "../analytics/DeeperAnalyses";
import ConversionAnalytics from "../analytics/ConversionAnalytics";
import ProductAnalytics from "../analytics/ProductAnalytics";
import LandingPages from "../analytics/LandingPages";
import SiteHealth from "../analytics/SiteHealth";
import CartCheckoutAnalytics from "../analytics/CartCheckoutAnalytics";
import FunnelBars from "../analytics/FunnelBars";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";
import ComingSoon from "../misc/ComingSoon";
import { BRAND, Logo } from "../../brand";
import {
    Activity, ArrowDownRight, ArrowUpRight,
    Bell, ChevronDown, Moon, Sun, Clock3, DollarSign, FileText, FlaskConical, Gauge, Globe, History, IndianRupee, LayoutDashboard,
    Lightbulb, Menu, Microscope, Package, RefreshCw, Route, Settings, ShieldCheck,
    ShoppingCart, TrendingUp, Users, X
} from "lucide-react";
import {
    Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
    Tooltip, XAxis, YAxis
} from "recharts";

const formatDay = (iso: string, long: boolean) => {
    const d = new Date(`${iso}T12:00:00`);
    return long
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : d.toLocaleDateString("en-US", { weekday: "short" });
};

// "Show change both ways everywhere, e.g. +0.34 pts (+16%)" (checklist section 1, P2).
// absUnit lets us label the absolute delta (pts, orders, ₹, etc.) distinctly from the %.
const changeBothWays = (absValue: number | null, pctValue: number | null, absUnit = "") => {
    if (absValue === null || pctValue === null) return "—";
    const absStr = `${absValue > 0 ? "+" : ""}${absValue}${absUnit}`;
    const pctStr = `${pctValue > 0 ? "+" : ""}${pctValue}%`;
    return `${absStr} (${pctStr})`;
};

// Same "both ways" format for money: "+$1,000 (+16.7%)".
const moneyChangeBothWays = (absValue: number | null, pctValue: number | null, currency?: string | null, digits = 0) => {
    if (absValue === null || pctValue === null) return "—";
    const sign = absValue > 0 ? "+" : absValue < 0 ? "-" : "";
    return `${sign}${formatMoney(Math.abs(absValue), currency, digits)} (${pctValue > 0 ? "+" : ""}${pctValue}%)`;
};

// Same "too early to compare" threshold as the backend (checklist section 1, P1).
const MIN_SESSIONS_FOR_COMPARISON = 500;

const shiftDate = (iso: string, days: number) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

// Small trend line for a KPI card (checklist section 2: "each with comparison
// and a small sparkline"). Last 14 complete days; blank days are skipped.
function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
    const data = values.map((v, i) => ({ i, v }));
    if (data.filter((d) => d.v !== null).length < 2) return null;
    return (
        <div className="mt-3 h-8 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                    <YAxis hide domain={["dataMin", "dataMax"]} />
                    <Line type="linear" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

// Funnel for one device (Mobile / Desktop), same look as FunnelBars, no comparison.
function DeviceFunnelBars({ data, device, error }: { data: DeviceFunnel | null; device: string; error: boolean }) {
    if (error) return <p className="text-xs text-slate-400">Device split isn't available from Shopify right now.</p>;
    if (!data) return <p className="text-xs text-slate-400">Loading…</p>;
    const d = data.devices[device];
    if (!d || !d.sessions) return <p className="text-xs text-slate-400">No {device.toLowerCase()} visits in this period.</p>;
    const all = Object.values(data.devices).reduce((n, x) => n + x.sessions, 0);
    const steps = [
        { label: "Sessions", value: d.sessions, prev: null as number | null },
        { label: "Added to cart", value: d.added_to_cart, prev: d.sessions },
        { label: "Reached checkout", value: d.reached_checkout, prev: d.added_to_cart },
        { label: "Completed purchase", value: d.completed_checkout, prev: d.reached_checkout },
    ];
    return (
        <div className="space-y-3">
            {steps.map((st) => (
                <div key={st.label}>
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                        <span className="font-medium text-slate-700">{st.label}</span>
                        <span className="text-slate-500">
                            <span className="font-semibold text-slate-900">{st.value.toLocaleString()}</span>
                            {st.prev != null && st.prev > 0 && <> · {Math.round((st.value / st.prev) * 1000) / 10}% of previous step</>}
                        </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max((st.value / d.sessions) * 100, 1.5)}%` }} />
                    </div>
                </div>
            ))}
            <p className="cro-note pt-1 text-[11px] text-slate-400">
                {device}: {Math.round((d.sessions / (all || 1)) * 100)}% of all visits · conversion {Math.round((d.completed_checkout / d.sessions) * 10000) / 100}% · {data.window_label}
            </p>
        </div>
    );
}

// Logo A from the approved Ocean Pro preview (funnel + rising arrow).
function Dashboard() {
    // Light / dark (Ocean Pro). Saved per browser; index.html applies it before paint.
    const [theme, setTheme] = useState<"light" | "dark">(() =>
        typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
    const toggleTheme = () => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        if (next === "dark") document.documentElement.dataset.theme = "dark";
        else delete document.documentElement.dataset.theme;
        try { localStorage.setItem("cro-theme", next); } catch { /* private mode */ }
    };
    useEffect(() => {
        document.title = BRAND.name;
    }, []);
    const [alarmRules, setAlarmRules] = useState<AlarmRuleItem[]>([]);
    const [activeNav, setActiveNav] = useState("Overview");
    const [mobileMenu, setMobileMenu] = useState(false);
    const [period, setPeriod] = useState("Last 7 days");

    // "Period controls: Yesterday / Last 7 vs prior 7 / Today so far, plus a
    // comparison picker" (checklist section 2, P1). Defaults to "yesterday" -
    // a complete day - not "today", per section 1's first fix-first item.
    const [overviewPeriod, setOverviewPeriod] = useState<"yesterday" | "today" | "last7">("yesterday");
    const [overviewCompare, setOverviewCompare] = useState<"4week_avg" | "last_week">("4week_avg");
    const [overview, setOverview] = useState<Overview | null>(null);

    // ---- Real data from backend ----
    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [trend, setTrend] = useState<CvrDay[]>([]);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    // Total Sales / Total Sessions tiles: Today / Yesterday / Last 30 days.
    const [kpiTotals, setKpiTotals] = useState<KpiTotals | null>(null);
    // Overview "More details" panel - remembered per browser (closed by default).
    const [showMore, setShowMoreState] = useState<boolean>(() => {
        try { return localStorage.getItem("cro.overview.more") === "1"; } catch { return false; }
    });
    const setShowMore = (f: (v: boolean) => boolean) =>
        setShowMoreState((v) => {
            const n = f(v);
            try { localStorage.setItem("cro.overview.more", n ? "1" : "0"); } catch { /* ignore */ }
            return n;
        });
    const [salesRange, setSalesRange] = useState<KpiRange>("today");
    const [sessRange, setSessRange] = useState<KpiRange>("today");
    // Top Selling Products card: its own Today / Yesterday / 7 days switch, always top 5.
    const [topPeriod, setTopPeriod] = useState<"today" | "yesterday" | "last7">("today");
    const [topLoading, setTopLoading] = useState(true);
    useEffect(() => {
        let alive = true;
        const load = () =>
            api.topProductsFor(topPeriod, 5)
                .then((r) => alive && setTopProducts(r.products))
                .catch(() => alive && setTopProducts([]))
                .finally(() => alive && setTopLoading(false));
        setTopLoading(true);
        setTopProducts([]);
        load();
        const timer = setInterval(load, 5 * 60 * 1000);
        return () => { alive = false; clearInterval(timer); };
    }, [topPeriod]);
    const [ordersTrend, setOrdersTrend] = useState<OrdersTrendDay[]>([]);
    const [funnel, setFunnel] = useState<FunnelCompare | null>(null);
    const [orderHealth, setOrderHealth] = useState<OrderHealth | null>(null);
    // A recommendation handed to the Experiments page as a pre-filled plan.
    const [expPrefill, setExpPrefill] = useState<ExperimentPrefill>(null);
    const clearExpPrefill = useCallback(() => setExpPrefill(null), []);
    // Order Health card: its own Today / Yesterday / 7 / 30 days switch, read live from Shopify.
    const [ohRange, setOhRange] = useState<OrderHealthRange>(30);
    const [ohLoading, setOhLoading] = useState(true);
    useEffect(() => {
        let alive = true;
        setOhLoading(true);
        setOrderHealth(null);
        api.orderHealth(ohRange)
            .then((r) => alive && setOrderHealth(r))
            .catch(() => alive && setOrderHealth(null))
            .finally(() => alive && setOhLoading(false));
        return () => { alive = false; };
    }, [ohRange]);
    const [changeLogEntries, setChangeLogEntries] = useState<ChangeLogEntry[]>([]);
    // "Total sales over time" + "Total sales breakdown" (manager's ask: bring
    // Shopify's own Analytics-page sales widgets onto our dashboard).
    const [salesTrend, setSalesTrend] = useState<SalesTrend | null>(null);
    const [salesDays, setSalesDays] = useState<7 | 14 | 28>(14);
    const [salesMode, setSalesMode] = useState<"area" | "bars">("area");
    const [salesBreakdown, setSalesBreakdown] = useState<SalesBreakdown | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const periodDays = period === "Last 30 days" ? 30 : 7;

    const loadData = useCallback(async () => {
        setError(null);
        try {
            const [s, t, ot, ov, cl, st, sb, ar, kt] = await Promise.all([
                api.summary(),
                // 2x the window: the earlier half is the dashed "previous period" line.
                api.cvrTrend(periodDays * 2).catch(() => ({ store_id: 0, days: [] as CvrDay[] })),
                api.ordersTrend(7).catch(() => ({ days: 7, trend: [] as OrdersTrendDay[] })),
                api.overview(overviewPeriod, overviewCompare).catch(() => null),
                api.changeLog(Math.max(periodDays, 28)).catch(() => ({ days: 0, valid_areas: [], entries: [] as ChangeLogEntry[] })),
                api.salesTrend(salesDays).catch(() => null),
                api.salesBreakdown(overviewPeriod, overviewCompare).catch(() => null),
                api.alarmRules().catch(() => [] as AlarmRuleItem[]),
                api.kpiTotals().catch(() => null),
            ]);
            setSummary(s);
            setTrend(t.days);
            setOrdersTrend(ot.trend);
            setOverview(ov);
            setChangeLogEntries(cl.entries);
            setSalesTrend(st);
            setSalesBreakdown(sb);
            setAlarmRules(ar);
            setKpiTotals(kt);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load dashboard data");
        } finally {
            setLoading(false);
        }
    }, [periodDays, overviewPeriod, overviewCompare, salesDays]);

    // Conversion Funnel card has its own Today / Yesterday / Last 7 switch; it
    // follows the Overview period picker when that changes.
    const [funnelPeriod, setFunnelPeriod] = useState<"today" | "yesterday" | "last7">("yesterday");
    const [funnelLoading, setFunnelLoading] = useState(true);
    // All / Mobile / Desktop switch on the funnel card (Ocean Pro).
    const [funnelDevice, setFunnelDevice] = useState<"All" | "Mobile" | "Desktop">("All");
    const [deviceFunnel, setDeviceFunnel] = useState<DeviceFunnel | null>(null);
    const [deviceFunnelErr, setDeviceFunnelErr] = useState(false);
    useEffect(() => {
        if (funnelDevice === "All") return;
        let alive = true;
        setDeviceFunnel(null);
        setDeviceFunnelErr(false);
        api.funnelDevices(funnelPeriod)
            .then((d) => alive && setDeviceFunnel(d))
            .catch(() => alive && setDeviceFunnelErr(true));
        return () => { alive = false; };
    }, [funnelDevice, funnelPeriod]);
    useEffect(() => setFunnelPeriod(overviewPeriod), [overviewPeriod]);
    useEffect(() => {
        let alive = true;
        const load = () =>
            api
                .funnelCompare(funnelPeriod)
                .then((f) => alive && setFunnel(f))
                .catch(() => alive && setFunnel(null))
                .finally(() => alive && setFunnelLoading(false));
        setFunnel(null);
        setFunnelLoading(true);
        load();
        const timer = setInterval(load, 5 * 60 * 1000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [funnelPeriod]);

    // "Daily Total Sales" card: plain daily totals, no comparison line, last
    // bar = today so far. Own day switch and 5-minute refresh.
    const [dailyDays, setDailyDays] = useState<7 | 14 | 28>(14);
    const [dailySales, setDailySales] = useState<SalesTrend | null>(null);
    const [dailyLoading, setDailyLoading] = useState(true);
    useEffect(() => {
        let alive = true;
        const load = () =>
            api
                .salesTrend(dailyDays, true)
                .then((d) => alive && setDailySales(d))
                .catch(() => alive && setDailySales(null))
                .finally(() => alive && setDailyLoading(false));
        setDailySales(null);
        setDailyLoading(true);
        load();
        const timer = setInterval(load, 5 * 60 * 1000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [dailyDays]);

    useEffect(() => {
        loadData();
        const timer = setInterval(loadData, 5 * 60 * 1000); // har 5 min auto-refresh
        return () => clearInterval(timer);
    }, [loadData]);

    const refreshNow = async () => {
        setSyncing(true);
        try {
            await api.sync();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Sync failed");
        }
        await loadData();
        setSyncing(false);
    };

    const currency = summary?.store.currency;
    // Conversion trend (checklist section 1, P2): straight line with dots for
    // this period, the period before as a dashed line, sessions as bars behind,
    // and real dates on the axis.
    const currentDays = trend.slice(-periodDays);
    const previousDays = trend.length > periodDays ? trend.slice(0, trend.length - periodDays) : [];
    const chartData = currentDays.map((d, i) => {
        const prev = previousDays.length === periodDays ? previousDays[i] : undefined;
        return { day: formatDay(d.date, true), cvr: d.cvr, previousCvr: prev?.cvr ?? null, sessions: d.sessions };
    });
    const markersFor = (labels: Set<string>) =>
        changeLogEntries
            .map((e) => ({ ...e, label: formatDay(e.date, true) }))
            .filter((e) => labels.has(e.label));
    // "Change-log markers on every trend chart" (checklist section 8, P1) -
    // only mark a change if its date actually falls inside the chart's window.
    const chartMarkers = markersFor(new Set(chartData.map((d) => d.day)));

    // Headline for the trend card: latest complete day vs the SAME weekday last
    // week (not the day before), with the too-early guard.
    const cvrByDate = new Map(trend.map((d) => [d.date, d]));
    const latestDay = currentDays.length ? currentDays[currentDays.length - 1] : undefined;
    const lastWeekDay = latestDay ? cvrByDate.get(shiftDate(latestDay.date, -7)) : undefined;
    const trendTooEarly = !latestDay || latestDay.sessions < MIN_SESSIONS_FOR_COMPARISON;
    const trendChange =
        latestDay?.cvr != null && lastWeekDay?.cvr != null && !trendTooEarly
            ? {
                  abs: Math.round((latestDay.cvr - lastWeekDay.cvr) * 100) / 100,
                  pct: lastWeekDay.cvr ? Math.round(((latestDay.cvr - lastWeekDay.cvr) / lastWeekDay.cvr) * 1000) / 10 : null,
              }
            : null;
    const lastWeekLabel = latestDay
        ? `vs ${new Date(`${shiftDate(latestDay.date, -7)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })} last week`
        : "";
    // "Total sales over time" - current period as a solid line, the same
    // number of days right before it as a dashed comparison line, aligned
    // by position (day 1 of this window vs day 1 of the previous window),
    // the same idea Shopify's own chart uses.
    const salesChartData = (salesTrend?.current ?? []).map((d, i) => ({
        day: formatDay(d.date, true),
        curDate: d.date,
        prevDate: salesTrend?.previous[i]?.date ?? null,
        current: d.revenue,
        previous: salesTrend?.previous[i]?.revenue ?? null,
    }));
    // "5 - 18 Nov" style labels for the two windows, so nobody has to guess
    // which dates the grey line is.
    const rangeText = (list: { date: string }[] | undefined) => {
        if (!list || list.length === 0) return "";
        const f = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        return `${f(list[0].date)} - ${f(list[list.length - 1].date)}`;
    };
    const salesCurRange = rangeText(salesTrend?.current);
    const salesPrevRange = rangeText(salesTrend?.previous);
    const salesMarkers = markersFor(new Set(salesChartData.map((d) => d.day)));
    // Days before our synced order history are null (unknown), not $0. Only
    // compare totals when both windows are fully covered.
    const salesCurrentComplete = salesChartData.length > 0 && salesChartData.every((d) => d.current !== null);
    const salesPrevComplete = salesChartData.length > 0 && salesChartData.every((d) => d.previous !== null);
    const salesTotal = salesChartData.reduce((sum, d) => sum + (d.current ?? 0), 0);
    const salesTotalPrev = salesChartData.reduce((sum, d) => sum + (d.previous ?? 0), 0);
    const salesTotalChangePct =
        salesCurrentComplete && salesPrevComplete && salesTotalPrev > 0
            ? Math.round(((salesTotal - salesTotalPrev) / salesTotalPrev) * 1000) / 10
            : null;
    const historyStartLabel = salesTrend?.history_start
        ? new Date(`${salesTrend.history_start}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : null;

    const dailyRows = (dailySales?.current ?? []).map((d) => ({
        day: formatDay(d.date, true),
        date: d.date,
        revenue: d.revenue,
        orders: d.orders,
        isToday: d.date === dailySales?.today,
    }));
    const dailyKnown = dailyRows.filter((d) => d.revenue !== null);
    const dailyTotal = dailyKnown.reduce((sum, d) => sum + (d.revenue ?? 0), 0);
    const dailyOrders = dailyKnown.reduce((sum, d) => sum + (d.orders ?? 0), 0);
    const dailyComplete = dailyKnown.filter((d) => !d.isToday);
    const dailyAvg = dailyComplete.length ? dailyComplete.reduce((sum, d) => sum + (d.revenue ?? 0), 0) / dailyComplete.length : null;
    const dailyBest = dailyComplete.reduce<(typeof dailyRows)[number] | null>((best, d) => (!best || (d.revenue ?? 0) > (best.revenue ?? 0) ? d : best), null);
    const dailyRange = rangeText(dailySales?.current);
    const dailyNice = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

     const activeRuleCount = alarmRules.filter((r) => r.is_active).length;


    const navGroups = [
        {
            label: "Main",
            items: [
                { name: "Overview", icon: LayoutDashboard },
                { name: "Conversion Analytics", icon: TrendingUp },
                { name: "Product Analytics", icon: Package },
                { name: "Landing Pages", icon: Route },
                { name: "Cart & Checkout", icon: ShoppingCart },
                { name: "Site Health", icon: Gauge },
                { name: "Deeper Analyses", icon: Microscope },
            ],
        },
        {
            label: "Optimization",
            items: [
                { name: "Recommendations", icon: Lightbulb },
                { name: "Experiments", icon: FlaskConical },
                { name: "Change Log", icon: History },
                { name: "Alarm Rules", icon: Bell },
                { name: "Alert History", icon: Activity },
            ],
        },
        {
            label: "Management",
            items: [
                { name: "Store Integration", icon: Globe },
                { name: "Settings", icon: Settings },
                { name: "Team", icon: Users },
            ],
        },
    ];

    return (
        <div className="ocean-bg min-h-screen text-slate-800">
            <div className="flex min-h-screen">

                {mobileMenu && (
                    <div
                        className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                        onClick={() => setMobileMenu(false)}
                    />
                )}

                <aside className={`ocean-side fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col text-white transition-transform lg:rounded-r-3xl lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
                    <div className="flex h-20 items-center justify-between px-6">
                        <div className="flex items-center gap-3">
                            <Logo size={36} />
                            <div>
                                <h1 className="text-[15px] font-bold tracking-tight text-white">{BRAND.name}</h1>
                                <p className="text-[9.5px] uppercase tracking-[0.2em] text-[#7fb0c6]">{BRAND.tagline}</p>
                            </div>
                        </div>
                        <button className="lg:hidden" onClick={() => setMobileMenu(false)}>
                            <X size={20} />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
                        {navGroups.map((group) => (
                        <div key={group.label} className="mb-6">
                        <p className="mb-2 px-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#7fb0c6]">{group.label}</p>
                        <nav className="space-y-1">
                            {group.items.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <button
                                        key={item.name}
                                        onClick={() => {
                                            setActiveNav(item.name);
                                            setMobileMenu(false);
                                        }}
                                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition ${activeNav === item.name ? "ocean-nav-on font-semibold shadow-lg shadow-black/10" : "text-[#b6d6e6] hover:bg-white/10 hover:text-white"}`}
                                    >
                                        <Icon size={18} />
                                        {item.name}
                                        {item.name === "Alarm Rules" && (
                                            <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] text-white">02</span>
                                        )}
                                        {item.name === "Team" && (
                                            <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[#7fb0c6]">Soon</span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>
                        </div>
                        ))}
                    </div>

                    {/* Hidden on short screens so the menu above always has room. */}
                    <div className="p-5 [@media(max-height:860px)]:hidden">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 flex items-center gap-2 text-[#bae6fd]">
                                <ShieldCheck size={18} />
                                <span className="text-xs font-semibold">Automation Status</span>
                            </div>
                            <p className="text-2xl font-bold">{activeRuleCount} / {alarmRules.length}</p>
                            <p className="mt-1 text-xs text-[#7fb0c6]">Alarm rules enabled</p>
                            <div className="mt-4 h-1.5 rounded-full bg-white/10">
                                <div className="h-full rounded-full bg-[#5eead4]" style={{ width: `${alarmRules.length ? (activeRuleCount / alarmRules.length) * 100 : 0}%` }} />
                            </div>
                        </div>
                        <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-5">
                            <Logo size={36} />
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{BRAND.name}</p>
                                <p className="truncate text-xs text-[#7fb0c6]">{summary?.store.name ?? BRAND.tagline}</p>
                            </div>
                            <button
                                onClick={() => {
                                    setActiveNav("Settings");
                                    setMobileMenu(false);
                                }}
                                title="Settings"
                                aria-label="Open settings"
                                className="ml-auto rounded-lg p-1.5 text-[#7fb0c6] transition hover:bg-white/10 hover:text-white"
                            >
                                <Settings size={17} />
                            </button>
                        </div>
                    </div>
                </aside>

                <main className="min-w-0 flex-1">
                    <header className="ocean-bg sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-200 px-5 sm:px-8">
                        <div className="flex items-center gap-3">
                            <button className="lg:hidden" onClick={() => setMobileMenu(true)}>
                                <Menu size={23} />
                            </button>
                            <div>
                                <p className="text-xs text-slate-400">Workspace / Dashboard</p>
                                <h2 className="text-lg font-bold text-slate-900">{activeNav}</h2>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className={`hidden items-center gap-2 rounded-full px-3 py-2 sm:flex ${error ? "bg-red-50" : "bg-emerald-50"}`}>
                                <span className={`h-2 w-2 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`} />
                                <span className={`text-xs font-semibold ${error ? "text-red-700" : "text-emerald-700"}`}>
                                    {error ? "Backend offline" : summary ? `Live · ${summary.store.name}` : "Connecting…"}
                                </span>
                            </div>
                            <button
                                onClick={toggleTheme}
                                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                                aria-label="Switch light / dark mode"
                                className="rounded-xl border border-slate-200 bg-white p-2.5 hover:bg-slate-50"
                            >
                                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
                            </button>
                            <button onClick={() => setActiveNav("Alert History")} className="relative rounded-xl border border-slate-200 bg-white p-2.5 hover:bg-slate-50">
                                <Bell size={19} />
                                {(summary?.open_alerts ?? 0) > 0 && (
                                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
                                )}
                            </button>
                            <Logo size={36} className="hidden sm:block" />
                        </div>
                    </header>

                    <>
                        {activeNav === "Alarm Rules" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <AlarmRules />
                            </div>
                        )}
                        {activeNav === "Alert History" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <AlertHistory />
                            </div>
                        )}
                        {activeNav === "Settings" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <SettingsPage />
                            </div>
                        )}
                        {activeNav === "Store Integration" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <StoreIntegration />
                            </div>
                        )}
                        {activeNav === "Recommendations" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <CroRecommendations
                                    onExperiment={(p) => {
                                        setExpPrefill(p);
                                        setActiveNav("Experiments");
                                    }}
                                />
                            </div>
                        )}
                        {activeNav === "Deeper Analyses" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <DeeperAnalyses />
                            </div>
                        )}
                        {activeNav === "Experiments" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <Experiments prefill={expPrefill} onPrefillUsed={clearExpPrefill} />
                            </div>
                        )}
                        {activeNav === "Change Log" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <ChangeLog />
                            </div>
                        )}
                        {activeNav === "Conversion Analytics" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <ConversionAnalytics />
                            </div>
                        )}
                        {activeNav === "Product Analytics" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <ProductAnalytics />
                            </div>
                        )}
                        {activeNav === "Landing Pages" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <LandingPages />
                            </div>
                        )}
                        {activeNav === "Cart & Checkout" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <CartCheckoutAnalytics />
                            </div>
                        )}
                        {activeNav === "Site Health" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <SiteHealth />
                            </div>
                        )}
                        {activeNav === "Team" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <ComingSoon
                                    icon={Users}
                                    title="Team Management"
                                    description="Invite teammates and control who can see or change what."
                                    roadmap={[
                                        "Invite multiple team members",
                                        "Roles & permissions (admin / member)",
                                        "Per-store access control",
                                        "Team-level notifications",
                                    ]}
                                />
                            </div>
                        )}

                        <div className={`mx-auto max-w-[1500px] space-y-7 p-5 sm:p-8 ${activeNav === "Overview" ? "" : "hidden"}`}>

                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                                <div>
                                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">CRO Performance Overview</h1>
                                    <p className="mt-2 text-sm text-slate-500">
                                        {summary?.store.timezone && (
                                            <span className="inline-flex items-center gap-1 text-slate-400">
                                                <Clock3 size={12} /> Store time: {summary.store.timezone}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <button onClick={refreshNow} disabled={syncing} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-60">
                                    <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing Shopify…" : "Refresh Dashboard"}
                                </button>
                            </div>


                            {/* Period controls + comparison picker (checklist section 2, P1).
                                Yesterday (a complete day) is the default; Today is an explicit toggle. */}
                            <div className="sticky top-20 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-md">
                                <span className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Period</span>
                                <div className="flex rounded-xl bg-slate-100 p-1">
                                    {([
                                        { key: "yesterday", label: "Yesterday" },
                                        { key: "last7", label: "Last 7 vs prior 7" },
                                        { key: "today", label: "Today so far" },
                                    ] as const).map((opt) => (
                                        <button
                                            key={opt.key}
                                            onClick={() => setOverviewPeriod(opt.key)}
                                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${overviewPeriod === opt.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                {overviewPeriod !== "last7" && (
                                    <>
                                        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Compare to</span>
                                        <select
                                            value={overviewCompare}
                                            onChange={(e) => setOverviewCompare(e.target.value as "4week_avg" | "last_week")}
                                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none"
                                        >
                                            <option value="4week_avg">4-week same-weekday average</option>
                                            <option value="last_week">Same weekday last week</option>
                                        </select>
                                    </>
                                )}
                                {overview && (
                                    <span className="ml-auto text-xs font-medium text-slate-500">{overview.period_label}</span>
                                )}
                            </div>

                            {/* Health strip: time of last order + mobile page speed (checklist section 2, P1). */}
                            <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                                <div className="flex items-center gap-2">
                                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600"><Clock3 size={16} /></div>
                                    <div>
                                        <p className="text-xs text-slate-400">Last order</p>
                                        <p className="text-sm font-semibold text-slate-800">
                                            {overview?.health.last_order_at ? timeAgo(overview.health.last_order_at) : loading ? "Loading…" : "No orders yet"}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="rounded-lg bg-blue-50 p-2 text-blue-600"><RefreshCw size={16} /></div>
                                    <div>
                                        <p className="text-xs text-slate-400">Orders copied from Shopify</p>
                                        <p className="text-sm font-semibold text-slate-800">
                                            {overview?.health.last_synced_at ? timeAgo(overview.health.last_synced_at) : loading ? "Loading…" : "Not yet"}
                                        </p>
                                    </div>
                                </div>
                                {(() => {
                                    const sp = overview?.health.mobile_page_speed;
                                    const tone = !sp ? "bg-slate-100 text-slate-400"
                                        : sp.rating === "good" ? "bg-emerald-50 text-emerald-600"
                                        : sp.rating === "poor" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600";
                                    const word = !sp ? "" : sp.rating === "good" ? "Good" : sp.rating === "poor" ? "Poor" : "Needs work";
                                    const chip = (r: string | null) => r === "good" ? "text-emerald-600" : r === "poor" ? "text-red-600" : r ? "text-amber-600" : "text-slate-400";
                                    return (
                                        <button type="button" onClick={() => setActiveNav("Site Health")} className="flex items-center gap-2 text-left" title="Open Site Health">
                                            <div className={`rounded-lg p-2 ${tone}`}><Gauge size={16} /></div>
                                            <div>
                                                <p className="text-xs text-slate-400">Mobile page speed{sp ? ` · ${sp.day_label}` : ""}</p>
                                                {sp ? (
                                                    <p className="text-sm font-semibold text-slate-800">
                                                        {word}
                                                        <span className="ml-2 text-xs font-medium">
                                                            <span className={chip(sp.lcp_rating)}>LCP {sp.lcp_ms != null ? (sp.lcp_ms / 1000).toFixed(1) + "s" : "—"}</span>
                                                            <span className="text-slate-300"> · </span>
                                                            <span className={chip(sp.inp_rating)}>INP {sp.inp_ms != null ? sp.inp_ms + "ms" : "—"}</span>
                                                            <span className="text-slate-300"> · </span>
                                                            <span className={chip(sp.cls_rating)}>CLS {sp.cls != null ? sp.cls.toFixed(2) : "—"}</span>
                                                        </span>
                                                    </p>
                                                ) : (
                                                    <p className="text-sm font-semibold text-slate-400">{loading ? "Loading…" : "No data from Shopify yet"}</p>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })()}
                            </div>

                            {error && (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                    Could not load live data: {error}
                                </div>
                            )}
                            {overview?.warnings?.map((w) => (
                                <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    {w}
                                </div>
                            ))}
                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                {(() => {
                                    const revenueMetric = overview?.metrics.revenue;
                                    const ordersMetric = overview?.metrics.orders;
                                    const aovMetric = overview?.metrics.aov;
                                    const cvrMetric = overview?.metrics.conversion_rate;
                                    const sessMetric = overview?.metrics.sessions;
                                    const rpsMetric = overview?.metrics.revenue_per_session;
                                    const periodLabel = overview?.period_label ?? "Loading…";
                                    const MoneyIcon = currency === "INR" ? IndianRupee : DollarSign;

                                    // "Colour by good or bad, not up or down" - for these four metrics more
                                    // is always better, so up=good(green)/down=bad(red); "—" when we can't
                                    // say yet (too early to compare, or no baseline).
                                    const changeTone = (changePct: number | null | undefined, tooEarly: boolean | undefined) => {
                                        if (tooEarly || changePct === null || changePct === undefined) return "slate";
                                        return changePct >= 0 ? "emerald" : "red";
                                    };

                                    const renderChange = (m: typeof revenueMetric, absUnit: string, money = false, digits = 0) => {
                                        // Only a real change gets a chip (user asked for no small notes).
                                        if (!m || m.too_early || m.baseline_value === null) return { text: "", tone: "slate", showArrow: false };
                                        const text = money
                                            ? moneyChangeBothWays(m.change_abs, m.change_pct, currency, digits)
                                            : changeBothWays(m.change_abs, m.change_pct, absUnit);
                                        const tone = changeTone(m.change_pct, m.too_early);
                                        return { text, tone, showArrow: text !== "—" && m.change_pct !== null && m.change_pct !== 0 };
                                    };
                                    const baselineNote = (m: typeof revenueMetric, fmt: (v: number) => string) =>
                                        !m ? "Loading…" : m.baseline_value === null
                                            ? `${m.baseline_label}: not enough order history yet`
                                            : `${m.baseline_label}: ${fmt(m.baseline_value)}`;

                                    const salesDays = salesTrend?.current ?? [];
                                    const revenueSpark = salesDays.map((d) => d.revenue);
                                    const ordersSpark = salesDays.map((d) => d.orders);
                                    const cvrSpark = trend.slice(-14).map((d) => d.cvr);
                                    const sessByDate = new Map(trend.map((d) => [d.date, d.sessions]));
                                    const aovSpark = salesDays.map((d) => (d.revenue != null && d.orders ? d.revenue / d.orders : null));
                                    const sessSpark = trend.slice(-14).map((d) => d.sessions);
                                    const rpsSpark = salesDays.map((d) => {
                                        const s = sessByDate.get(d.date);
                                        return d.revenue != null && s ? d.revenue / s : null;
                                    });
                                    const money2 = (v: number) => formatMoney(v, currency);
                                    // Total Sales / Total Sessions tiles: change vs the same weekday last
                                    // week (yesterday) or the 30 days before (last 30). None for today.
                                    const rangeChange = (cur: number | null | undefined, prev: number | null | undefined, money: boolean, tooEarly = false) => {
                                        if (cur == null || prev == null || prev === 0 || tooEarly) return { text: "", tone: "slate", showArrow: false };
                                        const abs = Math.round((cur - prev) * 100) / 100;
                                        const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
                                        const text = money ? moneyChangeBothWays(abs, pct, currency) : changeBothWays(Math.round(abs), pct);
                                        return { text, tone: pct >= 0 ? "emerald" : "red", showArrow: pct !== 0 };
                                    };
                                    const withCompare = (r: KpiRange) => {
                                        const l = kpiTotals?.labels[r];
                                        const c = kpiTotals?.compare_labels?.[r];
                                        return l ? (c ? `${l} · ${c}` : l) : "…";
                                    };
                                    const cards: {
                                        label: string; period: string; value: string; icon: typeof Bell; color: string;
                                        change: { text: string; tone: string; showArrow: boolean }; note: string;
                                        spark?: (number | null)[]; help: string;
                                        range?: { value: KpiRange; set: (r: KpiRange) => void };
                                    }[] = [
                                        {
                                            label: "Revenue", help: HELP.revenue,
                                            period: periodLabel,
                                            value: loading ? "…" : revenueMetric?.value != null ? formatMoney(revenueMetric.value, currency) : "—",
                                            icon: MoneyIcon, color: "rose",
                                            change: renderChange(revenueMetric, "", true),
                                            spark: revenueSpark,
                                            note: baselineNote(revenueMetric, money2),
                                        },
                                        {
                                            label: "Orders", help: HELP.orders,
                                            period: periodLabel,
                                            value: loading ? "…" : ordersMetric?.value != null ? String(ordersMetric.value) : "—",
                                            icon: Activity, color: "emerald",
                                            change: renderChange(ordersMetric, ""),
                                            spark: ordersSpark,
                                            note: baselineNote(ordersMetric, (v) => String(v)),
                                        },
                                        {
                                            label: "Average Order Value", help: "Average order value = sales after discounts / orders (cancelled and test orders left out). Compared the same way as the other cards.",
                                            period: periodLabel,
                                            value: loading ? "…" : aovMetric?.value != null ? formatMoney(aovMetric.value, currency, 2) : "—",
                                            icon: ShoppingCart, color: "blue",
                                            change: renderChange(aovMetric, "", true, 2),
                                            spark: aovSpark,
                                            note: baselineNote(aovMetric, (v) => formatMoney(v, currency, 2)),
                                        },
                                        {
                                            label: "Conversion Rate", help: HELP.conversionRate,
                                            period: periodLabel,
                                            value: loading ? "…" : cvrMetric?.value != null ? `${cvrMetric.value}%` : "—",
                                            icon: TrendingUp, color: "violet",
                                            change: renderChange(cvrMetric, " pts"),
                                            spark: cvrSpark,
                                            note: cvrMetric?.base_label ?? (overview?.cvr_error ? "Shopify analytics unavailable" : "Loading…"),
                                        },
                                        {
                                            label: "Sessions", help: "Visits to the store from Shopify Analytics, bots excluded. Compared the same way as the other cards; below ~500 sessions it's too early to compare.",
                                            period: periodLabel,
                                            value: loading ? "…" : sessMetric?.value != null ? sessMetric.value.toLocaleString() : "—",
                                            icon: Users, color: "amber",
                                            change: renderChange(sessMetric, ""),
                                            spark: sessSpark,
                                            note: baselineNote(sessMetric, (v) => v.toLocaleString()),
                                        },
                                        {
                                            label: "Revenue per Session", help: "Revenue per session = Shopify total sales / sessions (bots excluded) for the same period. Shows conversion and order value together in one number.",
                                            period: periodLabel,
                                            value: loading ? "…" : rpsMetric?.value != null ? formatMoney(rpsMetric.value, currency, 2) : "—",
                                            icon: MoneyIcon, color: "emerald",
                                            change: renderChange(rpsMetric, "", true, 2),
                                            spark: rpsSpark,
                                            note: baselineNote(rpsMetric, (v) => formatMoney(v, currency, 2)),
                                        },
                                        {
                                            label: "Total Sales", help: "Shopify's Total sales (after discounts and returns, incl. tax and shipping), same as Shopify Analytics. Switch between today so far, yesterday and the last 30 complete days.",
                                            period: withCompare(salesRange),
                                            value: kpiTotals?.sales[salesRange] != null ? formatMoney(kpiTotals.sales[salesRange] as number, currency) : loading ? "…" : "—",
                                            change: rangeChange(kpiTotals?.sales[salesRange], kpiTotals?.sales.previous?.[salesRange], true),
                                            icon: MoneyIcon, color: "blue",
                                            note: "",
                                            range: { value: salesRange, set: setSalesRange },
                                        },
                                        {
                                            label: "Total Sessions", help: "Visits to the store from Shopify Analytics, bots excluded (same as Shopify's Sessions). Switch between today so far, yesterday and the last 30 complete days.",
                                            period: withCompare(sessRange),
                                            value: kpiTotals?.sessions[sessRange] != null ? (kpiTotals.sessions[sessRange] as number).toLocaleString() : loading ? "…" : "—",
                                            change: rangeChange(kpiTotals?.sessions[sessRange], kpiTotals?.sessions.previous?.[sessRange], false, (kpiTotals?.sessions[sessRange] ?? 0) < MIN_SESSIONS_FOR_COMPARISON),
                                            icon: Users, color: "rose",
                                            note: "",
                                            range: { value: sessRange, set: setSessRange },
                                        },
                                    ];

                                    // Ocean Pro: colourful gradient tiles, white text. Up/down is
                                    // still shown by the arrow and the +/- sign on the chip.
                                    const tile: Record<string, string> = {
                                        rose: "kpi-blue", blue: "kpi-teal", violet: "kpi-indigo", emerald: "kpi-amber", amber: "kpi-rose",
                                    };
                                    return cards.map((item) => {
                                        const Icon = item.icon;
                                        const isDown = item.change.tone === "red";
                                        return (
                                            <div key={item.label} className={`kpi-tile ${tile[item.color] ?? "kpi-blue"} rounded-2xl p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg`}>
                                                <div className="relative flex items-center justify-between">
                                                    <div>
                                                        <p className="text-sm font-medium text-white/90">{item.label}<InfoTip text={item.help} /></p>
                                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">{item.period}</p>
                                                    </div>
                                                    <div className="rounded-xl bg-white/20 p-2.5 text-white"><Icon size={20} /></div>
                                                </div>
                                                <div className="relative mt-4 flex flex-wrap items-end justify-between gap-2">
                                                    <h3 className="text-3xl font-semibold tracking-tight text-white">{item.value}</h3>
                                                    {item.change.text && (
                                                        <span className={`kpi-chip mb-1 flex items-center gap-1 text-xs font-semibold text-white ${item.change.tone === "slate" ? "opacity-80" : ""}`}>
                                                            {item.change.showArrow && (isDown ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />)}
                                                            {item.change.text}
                                                        </span>
                                                    )}
                                                </div>
                                                {item.range && (
                                                    <div className="relative mt-4 flex w-fit rounded-lg bg-white/15 p-0.5 text-[11px]">
                                                        {([["today", "Today"], ["yesterday", "Yesterday"], ["last30", "30 days"]] as const).map(([k, l]) => (
                                                            <button
                                                                key={k}
                                                                onClick={() => item.range?.set(k)}
                                                                className={`whitespace-nowrap rounded-md px-2 py-1 font-semibold ${item.range?.value === k ? "bg-white text-slate-900" : "text-white/85 hover:bg-white/10"}`}
                                                            >
                                                                {l}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                {item.spark && <Sparkline values={item.spark} color="#ffffff" />}
                                                <p className="cro-note relative mt-2 text-xs text-white/80">{item.note}</p>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>

                            <div className="grid gap-6 xl:grid-cols-3">
                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:col-span-2 sm:p-6">
                                    <div className="mb-6 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Total Sales Over Time<InfoTip text={HELP.salesOverTime} /></h3>
                                            <p className="mt-1 text-xs text-slate-500">
                                                Daily sales: <b className="text-blue-600">{salesCurRange || "…"}</b> vs{" "}
                                                <b className="text-slate-500">{salesPrevRange || "…"}</b> (grey dashed line)
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                                            {(["area", "bars"] as const).map((m) => (
                                                <button
                                                    key={m}
                                                    onClick={() => setSalesMode(m)}
                                                    className={`rounded-md px-2 py-1 font-medium ${salesMode === m ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                                >
                                                    {m === "area" ? "Area" : "Bars"}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                                            {([7, 14, 28] as const).map((d) => (
                                                <button
                                                    key={d}
                                                    onClick={() => setSalesDays(d)}
                                                    className={`rounded-md px-2 py-1 font-medium ${salesDays === d ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                                >
                                                    {d} days
                                                </button>
                                            ))}
                                        </div>
                                        </div>
                                    </div>
                                    <div className="mb-4 flex items-end gap-3">
                                        <span className="text-3xl font-bold text-slate-900">{formatMoney(salesTotal, currency)}</span>
                                        {salesTotalChangePct !== null && (
                                            <span className={`mb-1 flex items-center gap-1 text-xs font-semibold ${salesTotalChangePct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                                {salesTotalChangePct < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                                {salesTotalChangePct > 0 ? "+" : ""}{salesTotalChangePct}% vs {salesPrevRange}
                                            </span>
                                        )}
                                    </div>
                                    {salesTotalChangePct !== null && (
                                        <p className="mb-3 text-sm text-slate-600">
                                            Sales are <b className={salesTotalChangePct < 0 ? "text-red-600" : "text-emerald-600"}>
                                                {salesTotalChangePct < 0 ? "down" : "up"} {Math.abs(salesTotalChangePct)}%
                                            </b>{" "}
                                            in the last {salesTrend?.days ?? salesDays} days ({formatMoney(salesTotal, currency)}) compared with the {salesTrend?.days ?? salesDays} days before ({formatMoney(salesTotalPrev, currency)}).
                                        </p>
                                    )}
                                    {salesChartData.length === 0 && (
                                        <p className="mb-2 text-xs text-slate-400">{loading ? "Loading…" : "No sales data available for this period."}</p>
                                    )}
                                    {historyStartLabel && (!salesCurrentComplete || !salesPrevComplete) && (
                                        <p className="cro-note mb-2 text-xs text-amber-600">Order history in this app starts {historyStartLabel}; earlier days are blank, not $0.</p>
                                    )}
                                    <SalesOverTimeChart rows={salesChartData} markers={salesMarkers} currency={currency} mode={salesMode} />
                                    <p className="cro-note text-[11px] text-slate-400">Drag the slider (or scroll inside the chart) to zoom into a few days.</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                                        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-blue-600" /> {salesCurRange}</span>
                                        <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-dashed border-slate-400" /> {salesPrevRange} (same weekday, one period earlier)</span>
                                        {salesMarkers.length > 0 && <span className="flex items-center gap-1.5"><span className="text-amber-500">●</span> a change from the Change Log</span>}
                                    </div>
                                </section>

                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Total Sales Breakdown<InfoTip text={HELP.salesBreakdown} /></h3>
                                            <p className="mt-1 text-xs text-slate-400">{salesBreakdown?.period_label ?? "Yesterday"}</p>
                                        </div>
                                        <FileText className="text-blue-500" size={20} />
                                    </div>
                                    {!salesBreakdown ? (
                                        <p className="text-xs text-slate-400">{loading ? "Loading…" : "No sales data available."}</p>
                                    ) : (
                                        <div className="divide-y divide-slate-100">
                                            {salesBreakdown.rows.map((row) => {
                                                // Discounts/Returns are costs: a SMALLER number is the good
                                                // outcome, so their color logic is flipped vs. everything else.
                                                const lowerIsBetter = row.label === "Discounts" || row.label.startsWith("Sales reversals");
                                                const isGood = row.change_pct === null ? null : lowerIsBetter ? row.change_pct < 0 : row.change_pct > 0;
                                                return (
                                                    <div key={row.label} className="flex items-center justify-between py-2.5">
                                                        <span className={`text-sm ${row.label === "Total sales" ? "font-bold text-slate-900" : "text-slate-600"}`}>{row.label}</span>
                                                        <div className="text-right">
                                                            <p className={`text-sm font-semibold ${row.label === "Total sales" ? "text-slate-900" : "text-slate-700"}`}>
                                                                {row.value === null ? "—" : formatMoney(lowerIsBetter ? -Math.abs(row.value) : row.value, currency)}
                                                            </p>
                                                            {!salesBreakdown.too_early && row.change_pct !== null && (
                                                                <p className={`text-[11px] ${row.change_pct === 0 ? "text-slate-400" : isGood ? "text-emerald-600" : "text-red-500"}`}>
                                                                    {moneyChangeBothWays(row.change_abs, row.change_pct, currency)}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {salesBreakdown?.too_early && (
                                        <p className="cro-note mt-3 text-xs text-slate-400">Too early to compare - below the usual order threshold for this period.</p>
                                    )}
                                    {salesBreakdown && !salesBreakdown.too_early && salesBreakdown.rows.every((r) => r.baseline_value === null) && (
                                        <p className="cro-note mt-3 text-xs text-slate-400">No comparison yet - not enough order history for {salesBreakdown.rows[0]?.baseline_label.replace(/^vs /, "the ")}.</p>
                                    )}
                                    {salesBreakdown && !salesBreakdown.too_early && salesBreakdown.rows[0]?.baseline_value !== null && (
                                        <p className="cro-note mt-3 text-xs text-slate-400">Changes are {salesBreakdown.rows[0]?.baseline_label}.</p>
                                    )}
                                    <p className="cro-note mt-3 text-xs text-slate-400">{salesBreakdown?.note}</p>
                                </section>
                            </div>

                            <WhereChangedCard currency={currency} />

                            <div className="grid gap-6">
                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Conversion Rate Trend<InfoTip text={HELP.cvrTrend} /></h3>
                                            <p className="mt-1 text-xs text-slate-400">Daily conversion rate from Shopify Analytics (store timezone) · bars: sessions</p>
                                        </div>
                                        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none">
                                            <option>Last 7 days</option>
                                            <option>Last 30 days</option>
                                        </select>
                                    </div>
                                    <div className="mb-4 flex flex-wrap items-end gap-3">
                                        <span className="text-3xl font-bold text-slate-900">{latestDay?.cvr != null ? `${latestDay.cvr}%` : "—"}</span>
                                        {latestDay && (
                                            <span className="mb-1 text-xs text-slate-400">{formatDay(latestDay.date, true)} ({latestDay.cvr != null ? `~${latestDay.sessions.toLocaleString()} sessions` : "no data"})</span>
                                        )}
                                        {trendTooEarly && latestDay ? (
                                            <span className="mb-1 text-xs font-semibold text-slate-400">Too early to compare</span>
                                        ) : trendChange && trendChange.pct !== null ? (
                                            <span className={`mb-1 flex items-center gap-1 text-xs font-semibold ${trendChange.abs === 0 ? "text-slate-400" : trendChange.abs < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                                {trendChange.abs !== 0 && (trendChange.abs < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />)}
                                                {changeBothWays(trendChange.abs, trendChange.pct, " pts")} {lastWeekLabel}
                                            </span>
                                        ) : latestDay ? (
                                            <span className="mb-1 text-xs font-semibold text-slate-400">— {lastWeekLabel}</span>
                                        ) : null}
                                    </div>
                                    {chartData.length === 0 && (
                                        <p className="mb-2 text-xs text-slate-400">{loading ? "Loading Shopify analytics…" : "No conversion data available for this period."}</p>
                                    )}
                                    <div className="h-64 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                                                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                <YAxis yAxisId="cvr" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} unit="%" />
                                                <YAxis yAxisId="sessions" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "#cbd5e1", fontSize: 11 }} />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                                                    formatter={(value, name) =>
                                                        name === "sessions"
                                                            ? [Number(value).toLocaleString(), "Sessions"]
                                                            : [`${value}%`, name === "cvr" ? "Conversion rate" : "Previous period"]
                                                    }
                                                />
                                                <Bar yAxisId="sessions" dataKey="sessions" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                                                <Line yAxisId="cvr" type="linear" dataKey="previousCvr" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
                                                <Line yAxisId="cvr" type="linear" dataKey="cvr" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                                                {chartMarkers.map((m) => (
                                                    <ReferenceLine
                                                        key={m.id}
                                                        yAxisId="cvr"
                                                        x={m.label}
                                                        stroke="#f59e0b"
                                                        strokeDasharray="4 3"
                                                        label={{ value: "●", position: "top", fill: "#f59e0b", fontSize: 10 }}
                                                    />
                                                ))}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <p className="cro-note mt-2 text-xs text-slate-400">Solid line with dots: last {periodDays} days · dashed: the {periodDays} days before</p>
                                    {chartMarkers.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                            {chartMarkers.map((m) => (
                                                <span key={m.id} className="flex items-center gap-1">
                                                    <span className="text-amber-500">●</span> {m.label}: {m.change}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </section>

                            </div>

                            <div className="grid gap-6 xl:grid-cols-2">
                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Top Selling Products<InfoTip text={HELP.topProducts} /></h3>
                                            <p className="mt-1 text-xs text-slate-400">
                                                {topPeriod === "today" ? "Today so far" : topPeriod === "yesterday" ? "Yesterday" : "Last 7 days"}, by revenue
                                            </p>
                                        </div>
                                        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                                            {([
                                                { key: "today", label: "Today" },
                                                { key: "yesterday", label: "Yesterday" },
                                                { key: "last7", label: "7 days" },
                                            ] as const).map((opt) => (
                                                <button
                                                    key={opt.key}
                                                    onClick={() => setTopPeriod(opt.key)}
                                                    className={`whitespace-nowrap rounded-md px-2 py-1 font-medium ${topPeriod === opt.key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {topProducts.length === 0 ? (
                                        <p className="text-xs text-slate-400">{topLoading ? "Loading…" : "No orders yet in this period."}</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {topProducts.map((p, i) => (
                                                <div key={p.name} className="flex items-center gap-3">
                                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">{i + 1}</div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                                                        <p className="text-xs text-slate-400">{p.quantity} sold{p.category ? ` · ${p.category}` : ""}</p>
                                                    </div>
                                                    <p className="shrink-0 text-sm font-bold text-slate-900">{formatMoney(p.revenue, currency)}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Conversion Funnel<InfoTip text={HELP.funnel} /></h3>
                                            <p className="mt-1 text-xs text-slate-400">{funnel ? `${funnel.period_label} · ${funnel.compare_label}` : "Loading…"}</p>
                                        </div>
                                        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                                            {([
                                                { key: "today", label: "Today" },
                                                { key: "yesterday", label: "Yesterday" },
                                                { key: "last7", label: "7 days" },
                                            ] as const).map((opt) => (
                                                <button
                                                    key={opt.key}
                                                    onClick={() => setFunnelPeriod(opt.key)}
                                                    className={`whitespace-nowrap rounded-md px-2 py-1 font-medium ${funnelPeriod === opt.key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="mb-4 flex w-fit rounded-lg border border-slate-200 p-0.5 text-xs">
                                        {(["All", "Mobile", "Desktop"] as const).map((d) => (
                                            <button
                                                key={d}
                                                onClick={() => setFunnelDevice(d)}
                                                className={`rounded-md px-2.5 py-1 font-medium ${funnelDevice === d ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                            >
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                    {funnelDevice === "All" ? (
                                        <FunnelBars data={funnel} loading={funnelLoading} compact />
                                    ) : (
                                        <DeviceFunnelBars data={deviceFunnel} device={funnelDevice} error={deviceFunnelErr} />
                                    )}
                                </section>
                            </div>

                            {/* "Overview stays small" (checklist section 10): the main cards stay on
                                top; supporting detail opens on demand and only loads when opened. */}
                            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60">
                                <button
                                    type="button"
                                    onClick={() => setShowMore((v) => !v)}
                                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                                >
                                    <span>
                                        <span className="block font-bold text-slate-900">More details</span>
                                        <span className="block text-xs text-slate-500">Daily total sales · AOV, sessions and sales by channel · Order health · Orders last 7 days · Traffic sources · When people buy</span>
                                    </span>
                                    <ChevronDown size={18} className={`shrink-0 text-slate-500 transition ${showMore ? "rotate-180" : ""}`} />
                                </button>
                            </div>
                            {showMore && (
                                <>
                            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h3 className="font-bold text-slate-900">Daily Total Sales<InfoTip text={HELP.dailySales} /></h3>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {dailyRange ? <>{dailyRange} · last bar is today so far</> : "…"}
                                        </p>
                                    </div>
                                    <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                                        {([7, 14, 28] as const).map((d) => (
                                            <button
                                                key={d}
                                                onClick={() => setDailyDays(d)}
                                                className={`rounded-md px-2 py-1 font-medium ${dailyDays === d ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                            >
                                                {d} days
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                                    <div>
                                        <p className="text-xs text-slate-500">Total sales</p>
                                        <p className="text-2xl font-bold text-slate-900">{dailyKnown.length ? formatMoney(dailyTotal, currency) : "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500">Orders</p>
                                        <p className="text-2xl font-bold text-slate-900">{dailyKnown.length ? dailyOrders.toLocaleString() : "—"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500">Average per day</p>
                                        <p className="text-2xl font-bold text-slate-900">{dailyAvg !== null ? formatMoney(dailyAvg, currency) : "—"}</p>
                                        <p className="cro-note text-[11px] text-slate-400">complete days only</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500">Best day</p>
                                        <p className="text-2xl font-bold text-slate-900">{dailyBest ? formatMoney(dailyBest.revenue ?? 0, currency) : "—"}</p>
                                        <p className="text-[11px] text-slate-400">{dailyBest ? dailyNice(dailyBest.date) : ""}</p>
                                    </div>
                                </div>
                                {dailyRows.length === 0 && (
                                    <p className="mb-2 text-xs text-slate-400">{dailyLoading ? "Loading…" : "No sales data available for this period."}</p>
                                )}
                                {dailyRows.some((d) => d.revenue === null) && dailySales?.history_start && (
                                    <p className="cro-note mb-2 text-xs text-amber-600">Order history in this app starts {dailyNice(dailySales.history_start)}; earlier days are blank, not $0.</p>
                                )}
                                <div className="h-64 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={dailyRows} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                                            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                            <Tooltip
                                                cursor={{ fill: "#f1f5f9" }}
                                                content={({ active, payload }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const row = payload[0].payload as (typeof dailyRows)[number];
                                                    return (
                                                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                                                            <p className="font-semibold text-slate-900">{dailyNice(row.date)}{row.isToday ? " (today so far)" : ""}</p>
                                                            <p className="mt-0.5 text-slate-600">
                                                                {row.revenue === null ? "no data" : `${formatMoney(row.revenue, currency)} · ${row.orders ?? 0} orders`}
                                                            </p>
                                                        </div>
                                                    );
                                                }}
                                            />
                                            <Bar dataKey="revenue" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                {dailyRows.map((d) => (
                                                    <Cell key={d.date} fill={d.isToday ? "#93c5fd" : "#2563eb"} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-blue-600" /> total sales that day</span>
                                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-blue-300" /> today so far</span>
                                </div>
                            </section>

                            <OverviewTrendsRow currency={currency} />

                            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h3 className="font-bold text-slate-900">Order Health<InfoTip text={HELP.orderHealth} /></h3>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {orderHealth ? <>Orders placed <b className="text-blue-700">{orderHealth.window_label}</b> · status as of now</> : "Loading…"}
                                        </p>
                                    </div>
                                    <div className="flex rounded-lg border bg-white p-0.5 text-xs">
                                        {([
                                            { key: "today", label: "Today" },
                                            { key: "yesterday", label: "Yesterday" },
                                            { key: 7, label: "7 days" },
                                            { key: 30, label: "30 days" },
                                        ] as const).map((opt) => (
                                            <button
                                                key={opt.key}
                                                onClick={() => setOhRange(opt.key)}
                                                className={`whitespace-nowrap rounded-md px-2 py-1 font-medium ${ohRange === opt.key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {orderHealth?.note && (
                                    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{orderHealth.note}</p>
                                )}
                                {!orderHealth || orderHealth.total_orders === 0 ? (
                                    <p className="text-xs text-slate-400">{ohLoading ? "Loading from Shopify…" : orderHealth ? "No orders in this window yet." : "Couldn't load order health."}</p>
                                ) : (
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                                        {[
                                            { label: "Paid", data: orderHealth.paid, color: "bg-emerald-500", text: "text-emerald-600" },
                                            { label: "Partially refunded", data: orderHealth.partially_refunded, color: "bg-amber-400", text: "text-amber-600" },
                                            { label: "Fully refunded", data: orderHealth.refunded, color: "bg-orange-500", text: "text-orange-600" },
                                            { label: "Cancelled", data: orderHealth.cancelled, color: "bg-red-500", text: "text-red-600" },
                                            { label: "Pending payment", data: orderHealth.pending, color: "bg-slate-400", text: "text-slate-500" },
                                        ].map((s) => (
                                            <div key={s.label} className="rounded-xl border border-slate-100 p-4">
                                                <p className="text-xs text-slate-500">{s.label}</p>
                                                <p className={`mt-1 text-xl font-bold ${s.text}`}>{s.data.pct}%</p>
                                                <p className="text-xs text-slate-500">{s.data.count.toLocaleString()} of {orderHealth.total_orders.toLocaleString()} orders</p>
                                                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                                                    <div className={`h-full rounded-full ${s.color}`} style={{ width: `${Math.max(s.data.pct, 2)}%` }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                                <BuyHeatmapCard />
                                <TrafficSourcesCard />
                            </div>
                            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                <div className="mb-5 flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-slate-900">Orders - Last 7 Days<InfoTip text={HELP.ordersTrend} /></h3>
                                        <p className="mt-1 text-xs text-slate-400">Daily order count (store timezone)</p>
                                    </div>
                                    <Activity className="text-emerald-500" size={20} />
                                </div>
                                <div className="h-48 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={ordersTrend.map((d) => ({ day: formatDay(d.date, false), orders: d.orders }))}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                                            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                                            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                                            <Bar dataKey="orders" fill="#10b981" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>
                                </>
                            )}

                            <footer className="flex flex-col justify-between gap-2 border-t border-slate-200 py-5 text-xs text-slate-400 sm:flex-row">
                                <p>© 2026 {BRAND.name}. All rights reserved.</p>
                                <p className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${summary ? "bg-emerald-500" : "bg-slate-400"}`} /> {summary ? `Live Shopify data · ${summary.store.domain} · synced ${timeAgo(summary.store.last_synced_at)}` : "Connecting to backend…"}</p>
                            </footer>
                        </div>
                        </>
                    </main>
            </div>
        </div>
    );
}

export default Dashboard;
