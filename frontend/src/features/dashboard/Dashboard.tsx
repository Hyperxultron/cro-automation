
import { useCallback, useEffect, useState } from "react";
import {
    api, formatMoney, timeAgo,
    type ChangeLogEntry, type CvrDay, type DashboardSummary, type Funnel, type OrderHealth, type Overview, type OrdersTrendDay, type SalesBreakdown, type SalesTrend, type TopProduct
} from "../../services/api";
import ChangeLog from "../changelog/ChangeLog";
import AlarmRules from "../alarms/AlarmRules";
import AlertHistory from "../alarms/AlertHistory";
import SettingsPage from "../settings/Settings";
import StoreIntegration from "../store/StoreIntegration";
import CroRecommendations from "../recommendations/CroRecommendations";
import ConversionAnalytics from "../analytics/ConversionAnalytics";
import ProductAnalytics from "../analytics/ProductAnalytics";
import CartCheckoutAnalytics from "../analytics/CartCheckoutAnalytics";
import ComingSoon from "../misc/ComingSoon";
import {
    Activity, ArrowDownRight, ArrowUpRight,
    Bell, CheckCircle2, Clock3, DollarSign, FileText, Filter, Gauge, Globe, History, IndianRupee, LayoutDashboard,
    Lightbulb, Mail, Menu, Package, RefreshCw, Settings, ShieldCheck,
    ShoppingBag, ShoppingCart, TrendingUp, Users, X
} from "lucide-react";
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
    Tooltip, XAxis, YAxis
} from "recharts";

const formatDay = (iso: string, long: boolean) => {
    const d = new Date(`${iso}T12:00:00`);
    return long
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : d.toLocaleDateString("en-US", { weekday: "short" });
};

const pct = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value}%`;

// "Show change both ways everywhere, e.g. +0.34 pts (+16%)" (checklist section 1, P2).
// absUnit lets us label the absolute delta (pts, orders, ₹, etc.) distinctly from the %.
const changeBothWays = (absValue: number | null, pctValue: number | null, absUnit = "") => {
    if (absValue === null || pctValue === null) return "—";
    const absStr = `${absValue > 0 ? "+" : ""}${absValue}${absUnit}`;
    const pctStr = `${pctValue > 0 ? "+" : ""}${pctValue}%`;
    return `${absStr} (${pctStr})`;
};

const initialAlarms = [
    {
        id: 1,
        title: "Quilt Orders Monitoring",
        description: "Alert if no quilt orders are received for 12 hours.",
        condition: "No orders for 12 hours",
        enabled: true,
        status: "Monitoring",
        icon: ShoppingBag,
    },
    {
        id: 2,
        title: "CVR Performance Alert",
        description: "Alert when yesterday's CVR drops 20% or more compared to the day before.",
        condition: "CVR drops by 20%",
        enabled: true,
        status: "Monitoring",
        icon: TrendingUp,
    },
];

function Dashboard() {
    const [alarms, setAlarms] = useState(initialAlarms);
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
    const [ordersTrend, setOrdersTrend] = useState<OrdersTrendDay[]>([]);
    const [funnel, setFunnel] = useState<Funnel | null>(null);
    const [orderHealth, setOrderHealth] = useState<OrderHealth | null>(null);
    const [changeLogEntries, setChangeLogEntries] = useState<ChangeLogEntry[]>([]);
    // "Total sales over time" + "Total sales breakdown" (manager's ask: bring
    // Shopify's own Analytics-page sales widgets onto our dashboard).
    const [salesTrend, setSalesTrend] = useState<SalesTrend | null>(null);
    const [salesBreakdown, setSalesBreakdown] = useState<SalesBreakdown | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const periodDays = period === "Last 30 days" ? 30 : 7;

    const loadData = useCallback(async () => {
        setError(null);
        try {
            const [s, t, tp, ot, f, oh, ov, cl, st, sb] = await Promise.all([
                api.summary(),
                api.cvrTrend(periodDays).catch(() => ({ store_id: 0, days: [] as CvrDay[] })),
                api.topProducts(1, 5).catch(() => ({ days: 1, products: [] as TopProduct[] })),
                api.ordersTrend(7).catch(() => ({ days: 7, trend: [] as OrdersTrendDay[] })),
                api.funnel().catch(() => null),
                api.orderHealth(30).catch(() => null),
                api.overview(overviewPeriod, overviewCompare).catch(() => null),
                api.changeLog(periodDays).catch(() => ({ days: 0, valid_areas: [], entries: [] as ChangeLogEntry[] })),
                api.salesTrend(14).catch(() => null),
                api.salesBreakdown(overviewPeriod, overviewCompare).catch(() => null),
            ]);
            setSummary(s);
            setTrend(t.days);
            setTopProducts(tp.products);
            setOrdersTrend(ot.trend);
            setFunnel(f);
            setOrderHealth(oh);
            setOverview(ov);
            setChangeLogEntries(cl.entries);
            setSalesTrend(st);
            setSalesBreakdown(sb);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load dashboard data");
        } finally {
            setLoading(false);
        }
    }, [periodDays, overviewPeriod, overviewCompare]);

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

    const quilt = summary?.quilt_alarm;
    const cvr = summary?.cvr;
    const currency = summary?.store.currency;
    const chartData = trend
        .filter((d) => d.cvr !== null)
        .map((d) => ({ day: formatDay(d.date, periodDays > 7), cvr: d.cvr }));
    // "Change-log markers on every trend chart" (checklist section 8, P1) -
    // only mark a change if its date actually falls inside the chart's window.
    const chartDayLabels = new Set(chartData.map((d) => d.day));
    const chartMarkers = changeLogEntries
        .map((e) => ({ ...e, label: formatDay(e.date, periodDays > 7) }))
        .filter((e) => chartDayLabels.has(e.label));
    // "Total sales over time" - current period as a solid line, the same
    // number of days right before it as a dashed comparison line, aligned
    // by position (day 1 of this window vs day 1 of the previous window),
    // the same idea Shopify's own chart uses.
    const salesChartData = (salesTrend?.current ?? []).map((d, i) => ({
        day: formatDay(d.date, true),
        current: d.revenue,
        previous: salesTrend?.previous[i]?.revenue ?? null,
    }));
    const salesTotal = salesChartData.reduce((sum, d) => sum + d.current, 0);
    const salesTotalPrev = salesChartData.reduce((sum, d) => sum + (d.previous ?? 0), 0);
    const salesTotalChangePct = salesTotalPrev > 0 ? Math.round(((salesTotal - salesTotalPrev) / salesTotalPrev) * 1000) / 10 : null;

    const cvrDiff =
        cvr?.yesterday_cvr != null && cvr?.previous_cvr != null
            ? Math.round((cvr.yesterday_cvr - cvr.previous_cvr) * 100) / 100
            : null;

    const quiltStatusText: Record<string, string> = {
        normal: "Normal",
        alarm_triggered: "ALERT",
        alarm_active: "ALERT",
        no_quilt_orders_yet: "No quilt orders yet",
        no_quilt_products: "No quilt products",
        no_active_rule: "Rule inactive",
    };
    const quiltAlert = quilt?.status === "alarm_triggered" || quilt?.status === "alarm_active";
    const cvrAlert = cvr?.drop_percent != null && cvr.drop_percent >= 20;

    const alarmLive: Record<number, { text: string; alert: boolean }> = {
        1: {
            text: quilt?.last_quilt_order_at
                ? `Last quilt order ${quilt.last_quilt_order_number} · ${timeAgo(quilt.last_quilt_order_at)} (${quilt.hours_elapsed}h / ${quilt.threshold_hours}h)`
                : quiltStatusText[quilt?.status ?? ""] ?? "Loading…",
            alert: quiltAlert,
        },
        2: {
            text: cvr
                ? `Yesterday ${cvr.yesterday_cvr ?? "—"}% vs ${cvr.previous_cvr ?? "—"}% · change ${cvr.drop_percent === null ? "—" : `${-cvr.drop_percent}%`}`
                : summary?.cvr_error
                  ? "Analytics unavailable"
                  : "Loading…",
            alert: cvrAlert,
        },
    };

    const activities = summary
        ? [
              {
                  title: "Quilt orders monitoring",
                  detail: alarmLive[1].text,
                  time: quiltAlert ? "Alert" : quiltStatusText[quilt?.status ?? ""] ?? "Active",
                  type: quiltAlert ? "alert" : "monitor",
              },
              {
                  title: "CVR comparison",
                  detail: alarmLive[2].text,
                  time: cvrAlert ? "Alert" : cvr ? "Normal" : "Pending",
                  type: cvrAlert ? "alert" : "monitor",
              },
              {
                  title: "Shopify data sync",
                  detail: `${summary.store.name} · synced ${timeAgo(summary.store.last_synced_at)} · auto every 15 min`,
                  time: "Live",
                  type: "monitor",
              },
              {
                  title: "Email notifications",
                  detail: "Email delivery setup pending",
                  time: "Pending",
                  type: "email",
              },
          ]
        : [];

    const toggleAlarm = (id: number) => {
        setAlarms((current) =>
            current.map((alarm) =>
                alarm.id === id
                    ? { ...alarm, enabled: !alarm.enabled }
                    : alarm
            )
        );
    };

    const navGroups = [
        {
            label: "Main",
            items: [
                { name: "Overview", icon: LayoutDashboard },
                { name: "Conversion Analytics", icon: TrendingUp },
                { name: "Product Analytics", icon: Package },
                { name: "Cart & Checkout", icon: ShoppingCart },
            ],
        },
        {
            label: "Optimization",
            items: [
                { name: "Recommendations", icon: Lightbulb },
                { name: "Change Log", icon: History },
                { name: "Alarm Rules", icon: Bell },
                { name: "Alert History", icon: Activity },
                { name: "Reports", icon: FileText },
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
        <div className="min-h-screen bg-[#f5f7fb] text-slate-800">
            <div className="flex min-h-screen">

                {mobileMenu && (
                    <div
                        className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                        onClick={() => setMobileMenu(false)}
                    />
                )}

                <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#111c32] text-white transition-transform lg:static lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
                    <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500">
                                <Activity size={23} />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold tracking-tight">CRO<span className="text-blue-400">.AI</span></h1>
                                <p className="text-[10px] tracking-[2px] text-slate-400">AUTOMATION</p>
                            </div>
                        </div>
                        <button className="lg:hidden" onClick={() => setMobileMenu(false)}>
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 pt-8">
                        {navGroups.map((group) => (
                        <div key={group.label} className="mb-6">
                        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[2px] text-slate-500">{group.label}</p>
                        <nav className="space-y-1.5">
                            {group.items.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <button
                                        key={item.name}
                                        onClick={() => {
                                            setActiveNav(item.name);
                                            setMobileMenu(false);
                                        }}
                                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition ${activeNav === item.name ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
                                    >
                                        <Icon size={18} />
                                        {item.name}
                                        {item.name === "Alarm Rules" && (
                                            <span className="ml-auto rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">02</span>
                                        )}
                                        {(item.name === "Reports" || item.name === "Team") && (
                                            <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">Soon</span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>
                        </div>
                        ))}
                    </div>

                    <div className="p-5">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 flex items-center gap-2 text-blue-300">
                                <ShieldCheck size={18} />
                                <span className="text-xs font-semibold">Automation Status</span>
                            </div>
                            <p className="text-2xl font-bold">2 / 2</p>
                            <p className="mt-1 text-xs text-slate-400">Alarm rules enabled</p>
                            <div className="mt-4 h-1.5 rounded-full bg-white/10">
                                <div className="h-full w-full rounded-full bg-blue-500" />
                            </div>
                        </div>
                        <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-5">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-sm font-bold">A</div>
                            <div>
                                <p className="text-sm font-medium">Admin</p>
                                <p className="text-xs text-slate-500">CRO Workspace</p>
                            </div>
                            <Settings size={17} className="ml-auto text-slate-500" />
                        </div>
                    </div>
                </aside>

                <main className="min-w-0 flex-1">
                    <header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8">
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
                            <button onClick={() => setActiveNav("Alert History")} className="relative rounded-xl border border-slate-200 p-2.5 hover:bg-slate-50">
                                <Bell size={19} />
                                {(summary?.open_alerts ?? 0) > 0 && (
                                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
                                )}
                            </button>
                            <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 sm:flex">A</div>
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
                                <CroRecommendations />
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
                        {activeNav === "Cart & Checkout" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <CartCheckoutAnalytics />
                            </div>
                        )}
                        {activeNav === "Reports" && (
                            <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
                                <ComingSoon
                                    icon={FileText}
                                    title="Reports"
                                    description="Daily, weekly and monthly store performance reports."
                                    roadmap={[
                                        "Daily / weekly / monthly performance reports",
                                        "Product performance & alarm summary reports",
                                        "PDF / CSV export",
                                        "Scheduled automated email reports",
                                    ]}
                                />
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
                                    <p className="text-sm text-slate-500">Welcome to your monitoring workspace</p>
                                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">CRO Performance Overview</h1>
                                    <p className="mt-2 text-sm text-slate-500">
                                        Monitor your store performance and automated alerts.
                                        {summary?.store.timezone && (
                                            <span className="ml-2 inline-flex items-center gap-1 text-slate-400">
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
                            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
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
                                    <div className="rounded-lg bg-slate-100 p-2 text-slate-400"><Gauge size={16} /></div>
                                    <div>
                                        <p className="text-xs text-slate-400">Mobile page speed</p>
                                        <p className="text-sm font-semibold text-slate-400">
                                            Not available yet <span className="font-normal text-slate-400">(Core Web Vitals not wired up)</span>
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                    Could not load live data: {error}
                                </div>
                            )}
                            {(quiltAlert || cvrAlert) && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                                    {quiltAlert && <p>⚠ No quilt order for {quilt?.hours_elapsed} hours (limit {quilt?.threshold_hours}h). Last: {quilt?.last_quilt_order_number}</p>}
                                    {cvrAlert && <p>⚠ Conversion rate dropped {cvr?.drop_percent}% ({cvr?.previous_cvr}% → {cvr?.yesterday_cvr}%)</p>}
                                </div>
                            )}

                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                                {(() => {
                                    const revenueMetric = overview?.metrics.revenue;
                                    const ordersMetric = overview?.metrics.orders;
                                    const aovMetric = overview?.metrics.aov;
                                    const cvrMetric = overview?.metrics.conversion_rate;
                                    const periodLabel = overview?.period_label ?? "Loading…";
                                    const MoneyIcon = currency === "INR" ? IndianRupee : DollarSign;

                                    // "Colour by good or bad, not up or down" - for these four metrics more
                                    // is always better, so up=good(green)/down=bad(red); "—" when we can't
                                    // say yet (too early to compare, or no baseline).
                                    const changeTone = (changePct: number | null | undefined, tooEarly: boolean | undefined) => {
                                        if (tooEarly || changePct === null || changePct === undefined) return "slate";
                                        return changePct >= 0 ? "emerald" : "red";
                                    };

                                    const renderChange = (m: typeof revenueMetric, absUnit: string) => {
                                        if (!m) return { text: loading ? "Loading…" : "—", tone: "slate", showArrow: false };
                                        if (m.too_early) return { text: "Too early to compare", tone: "slate", showArrow: false };
                                        const text = changeBothWays(m.change_abs, m.change_pct, absUnit);
                                        const tone = changeTone(m.change_pct, m.too_early);
                                        return { text, tone, showArrow: m.change_pct !== null && m.change_pct !== 0 };
                                    };

                                    const cards = [
                                        {
                                            label: "Revenue",
                                            period: periodLabel,
                                            value: loading ? "…" : revenueMetric?.value != null ? formatMoney(revenueMetric.value, currency) : "—",
                                            icon: MoneyIcon, color: "rose",
                                            change: renderChange(revenueMetric, ""),
                                            note: aovMetric?.value != null ? `AOV ${formatMoney(aovMetric.value, currency)} · vs ${formatMoney(aovMetric.baseline_value ?? 0, currency)} baseline` : "Loading…",
                                        },
                                        {
                                            label: "Quilt Orders Today",
                                            period: "Today",
                                            value: loading ? "…" : String(summary?.today.quilt_orders ?? "—"),
                                            change: {
                                                text: summary?.changes.quilt_orders_pct == null ? "—" : `${pct(summary.changes.quilt_orders_pct)} vs same time yday`,
                                                tone: (summary?.changes.quilt_orders_pct ?? 0) >= 0 ? "emerald" : "red",
                                                showArrow: summary?.changes.quilt_orders_pct != null,
                                            },
                                            icon: ShoppingBag, color: "blue",
                                            note: summary ? `Yesterday: ${summary.yesterday.quilt_orders} quilt orders (store time)` : "Loading…",
                                        },
                                        {
                                            label: "Conversion Rate",
                                            period: periodLabel,
                                            value: loading ? "…" : cvrMetric?.value != null ? `${cvrMetric.value}%` : "—",
                                            icon: TrendingUp, color: "violet",
                                            change: renderChange(cvrMetric, " pts"),
                                            note: cvrMetric?.base_label ?? (overview?.cvr_error ? "Shopify analytics unavailable" : "Loading…"),
                                        },
                                        {
                                            label: "Orders",
                                            period: periodLabel,
                                            value: loading ? "…" : ordersMetric?.value != null ? String(ordersMetric.value) : "—",
                                            icon: Activity, color: "emerald",
                                            change: renderChange(ordersMetric, ""),
                                            note: ordersMetric ? `${ordersMetric.baseline_label}: ${ordersMetric.baseline_value}` : "Loading…",
                                        },
                                        {
                                            label: "Open Alerts",
                                            period: "Now",
                                            value: loading ? "…" : String(summary?.open_alerts ?? 0),
                                            change: { text: `${summary?.active_rules ?? 0} rules active`, tone: "slate", showArrow: false },
                                            icon: Bell, color: "amber",
                                            note: "Email delivery setup pending",
                                        },
                                    ];

                                    const colors: Record<string, string> = {
                                        blue: "bg-blue-50 text-blue-600",
                                        violet: "bg-violet-50 text-violet-600",
                                        emerald: "bg-emerald-50 text-emerald-600",
                                        amber: "bg-amber-50 text-amber-600",
                                        rose: "bg-rose-50 text-rose-600",
                                    };
                                    const toneText: Record<string, string> = {
                                        emerald: "text-emerald-600",
                                        red: "text-red-600",
                                        slate: "text-slate-400",
                                    };

                                    return cards.map((item) => {
                                        const Icon = item.icon;
                                        const isDown = item.change.tone === "red";
                                        return (
                                            <div key={item.label} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="text-sm font-medium text-slate-500">{item.label}</p>
                                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.period}</p>
                                                    </div>
                                                    <div className={`rounded-xl p-2.5 ${colors[item.color]}`}><Icon size={20} /></div>
                                                </div>
                                                <div className="mt-4 flex items-end justify-between">
                                                    <h3 className="text-3xl font-bold tracking-tight text-slate-900">{item.value}</h3>
                                                    <span className={`mb-1 flex items-center gap-1 text-xs font-semibold ${toneText[item.change.tone] ?? "text-slate-400"}`}>
                                                        {item.change.showArrow && (isDown ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />)}
                                                        {item.change.text}
                                                    </span>
                                                </div>
                                                <p className="mt-2 text-xs text-slate-400">{item.note}</p>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>

                            <div className="grid gap-6 xl:grid-cols-3">
                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:col-span-2 sm:p-6">
                                    <div className="mb-6 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Total Sales Over Time</h3>
                                            <p className="mt-1 text-xs text-slate-400">Last {salesTrend?.days ?? 14} days vs the {salesTrend?.days ?? 14} days before that</p>
                                        </div>
                                        <DollarSign className="text-blue-500" size={20} />
                                    </div>
                                    <div className="mb-4 flex items-end gap-3">
                                        <span className="text-3xl font-bold text-slate-900">{formatMoney(salesTotal, currency)}</span>
                                        {salesTotalChangePct !== null && (
                                            <span className={`mb-1 flex items-center gap-1 text-xs font-semibold ${salesTotalChangePct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                                {salesTotalChangePct < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                                {salesTotalChangePct > 0 ? "+" : ""}{salesTotalChangePct}% vs previous period
                                            </span>
                                        )}
                                    </div>
                                    {salesChartData.length === 0 && (
                                        <p className="mb-2 text-xs text-slate-400">{loading ? "Loading…" : "No sales data available for this period."}</p>
                                    )}
                                    <div className="h-64 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={salesChartData}>
                                                <defs>
                                                    <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                                                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                                                    formatter={(value, name) => [formatMoney(Number(value) || 0, currency), name === "current" ? "This period" : "Previous period"]}
                                                />
                                                <Area type="monotone" dataKey="current" stroke="#10b981" strokeWidth={3} fill="url(#salesGradient)" />
                                                <Area type="monotone" dataKey="previous" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3" fill="none" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </section>

                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Total Sales Breakdown</h3>
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
                                                const lowerIsBetter = row.label === "Discounts" || row.label === "Returns";
                                                const isGood = row.change_pct === null ? null : lowerIsBetter ? row.change_pct < 0 : row.change_pct > 0;
                                                return (
                                                    <div key={row.label} className="flex items-center justify-between py-2.5">
                                                        <span className={`text-sm ${row.label === "Total sales" ? "font-bold text-slate-900" : "text-slate-600"}`}>{row.label}</span>
                                                        <div className="text-right">
                                                            <p className={`text-sm font-semibold ${row.label === "Total sales" ? "text-slate-900" : "text-slate-700"}`}>
                                                                {row.value === null ? "—" : formatMoney(lowerIsBetter ? -Math.abs(row.value) : row.value, currency)}
                                                            </p>
                                                            {!salesBreakdown.too_early && row.change_pct !== null && (
                                                                <p className={`text-[11px] ${isGood ? "text-emerald-600" : "text-red-500"}`}>
                                                                    {row.change_pct > 0 ? "+" : ""}{row.change_pct}%
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {salesBreakdown?.too_early && (
                                        <p className="mt-3 text-xs text-slate-400">Too early to compare - below the usual order threshold for this period.</p>
                                    )}
                                    <p className="mt-3 text-xs text-slate-400">{salesBreakdown?.note}</p>
                                </section>
                            </div>

                            <div className="grid gap-6 xl:grid-cols-3">
                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:col-span-2 sm:p-6">
                                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Conversion Rate Trend</h3>
                                            <p className="mt-1 text-xs text-slate-400">Daily conversion rate from Shopify Analytics (store timezone)</p>
                                        </div>
                                        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none">
                                            <option>Last 7 days</option>
                                            <option>Last 30 days</option>
                                        </select>
                                    </div>
                                    <div className="mb-4 flex items-end gap-3">
                                        <span className="text-3xl font-bold text-slate-900">{cvr?.yesterday_cvr != null ? `${cvr.yesterday_cvr}%` : "—"}</span>
                                        <span className={`mb-1 flex items-center gap-1 text-xs font-semibold ${cvrDiff !== null && cvrDiff < 0 ? "text-red-600" : "text-emerald-600"}`}><ArrowUpRight size={15} className={cvrDiff !== null && cvrDiff < 0 ? "rotate-90" : ""} /> {cvrDiff === null ? "—" : `${cvrDiff > 0 ? "+" : ""}${cvrDiff} pts vs day before`}</span>
                                    </div>
                                    {chartData.length === 0 && (
                                        <p className="mb-2 text-xs text-slate-400">{loading ? "Loading Shopify analytics…" : "No conversion data available for this period."}</p>
                                    )}
                                    <div className="h-64 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={chartData}>
                                                <defs>
                                                    <linearGradient id="cvrGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                                                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                                                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} unit="%" />
                                                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                                                <Area type="monotone" dataKey="cvr" stroke="#3b82f6" strokeWidth={3} fill="url(#cvrGradient)" />
                                                {chartMarkers.map((m) => (
                                                    <ReferenceLine
                                                        key={m.id}
                                                        x={m.label}
                                                        stroke="#f59e0b"
                                                        strokeDasharray="4 3"
                                                        label={{ value: "●", position: "top", fill: "#f59e0b", fontSize: 10 }}
                                                    />
                                                ))}
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
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

                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Alarm Overview</h3>
                                            <p className="mt-1 text-xs text-slate-400">Your automation rules</p>
                                        </div>
                                        <Bell className="text-blue-500" size={21} />
                                    </div>
                                    <div className="mt-7 space-y-5">
                                        {alarms.map((alarm) => {
                                            const Icon = alarm.icon;
                                            return (
                                                <div key={alarm.id} className="flex items-start gap-3">
                                                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><Icon size={20} /></div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-semibold text-slate-800">{alarm.title}</p>
                                                        <p className="mt-1 text-xs text-slate-400">{alarm.condition}</p>
                                                        {summary && (
                                                            <p className={`mt-1 text-xs ${alarmLive[alarm.id]?.alert ? "font-semibold text-red-600" : "text-slate-500"}`}>{alarmLive[alarm.id]?.text}</p>
                                                        )}
                                                        <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${alarm.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                                            {alarm.enabled ? "Enabled" : "Paused"}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <button onClick={() => setActiveNav("Alarm Rules")} className="mt-7 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Manage Alarm Rules</button>
                                </section>
                            </div>

                            <div className="grid gap-6 xl:grid-cols-3">
                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Top Selling Products</h3>
                                            <p className="mt-1 text-xs text-slate-400">Today, by revenue</p>
                                        </div>
                                        <Package className="text-blue-500" size={20} />
                                    </div>
                                    {topProducts.length === 0 ? (
                                        <p className="text-xs text-slate-400">{loading ? "Loading…" : "No orders yet today."}</p>
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
                                            <h3 className="font-bold text-slate-900">Orders - Last 7 Days</h3>
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

                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Conversion Funnel</h3>
                                            <p className="mt-1 text-xs text-slate-400">{funnel?.date ? `Yesterday (${funnel.date})` : "Yesterday"}</p>
                                        </div>
                                        <Filter className="text-violet-500" size={20} />
                                    </div>
                                    {!funnel || funnel.sessions === 0 ? (
                                        <p className="text-xs text-slate-400">{loading ? "Loading…" : "No session data available."}</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {[
                                                { label: "Sessions", value: funnel.sessions, pct: 100 },
                                                { label: "Added to Cart", value: funnel.added_to_cart, pct: funnel.cart_rate ?? 0 },
                                                { label: "Reached Checkout", value: funnel.reached_checkout, pct: funnel.checkout_rate ?? 0 },
                                                { label: "Completed Purchase", value: funnel.completed_checkout, pct: funnel.conversion_rate ?? 0 },
                                            ].map((stage) => (
                                                <div key={stage.label}>
                                                    <div className="mb-1 flex items-center justify-between text-xs">
                                                        <span className="font-medium text-slate-600">{stage.label}</span>
                                                        <span className="font-semibold text-slate-900">{stage.value} <span className="text-slate-400">({stage.pct}%)</span></span>
                                                    </div>
                                                    <div className="h-2 w-full rounded-full bg-slate-100">
                                                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(stage.pct, 2)}%` }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>

                            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                <div className="mb-5 flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-slate-900">Order Health</h3>
                                        <p className="mt-1 text-xs text-slate-400">Paid / refunded / cancelled breakdown, last {orderHealth?.days ?? 30} days</p>
                                    </div>
                                    <ShieldCheck className="text-emerald-500" size={20} />
                                </div>
                                {!orderHealth || orderHealth.total_orders === 0 ? (
                                    <p className="text-xs text-slate-400">{loading ? "Loading…" : "No orders in this window yet."}</p>
                                ) : (
                                    <div className="grid gap-4 sm:grid-cols-4">
                                        {[
                                            { label: "Paid", data: orderHealth.paid, color: "bg-emerald-500", text: "text-emerald-600" },
                                            { label: "Refunded", data: orderHealth.refunded, color: "bg-amber-500", text: "text-amber-600" },
                                            { label: "Cancelled", data: orderHealth.cancelled, color: "bg-red-500", text: "text-red-600" },
                                            { label: "Pending", data: orderHealth.pending, color: "bg-slate-400", text: "text-slate-500" },
                                        ].map((s) => (
                                            <div key={s.label} className="rounded-xl border border-slate-100 p-4">
                                                <p className="text-xs text-slate-500">{s.label}</p>
                                                <p className={`mt-1 text-xl font-bold ${s.text}`}>{s.data.pct}%</p>
                                                <p className="text-xs text-slate-400">{s.data.count} of {orderHealth.total_orders} orders</p>
                                                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                                                    <div className={`h-full rounded-full ${s.color}`} style={{ width: `${Math.max(s.data.pct, 2)}%` }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="mt-4 text-xs text-slate-400">
                                    A rising refund or cancellation rate is often an early sign of checkout friction, payment issues, or a stock/fulfillment problem.
                                </p>
                            </section>

                            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h3 className="font-bold text-slate-900">Automation Rules</h3>
                                        <p className="mt-1 text-xs text-slate-400">Control your store monitoring conditions</p>
                                    </div>
                                    <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{alarms.filter(a => a.enabled).length} Active</span>
                                </div>
                                <div className="grid gap-4 lg:grid-cols-2">
                                    {alarms.map((alarm) => {
                                        const Icon = alarm.icon;
                                        return (
                                            <div key={alarm.id} className="rounded-xl border border-slate-200 p-5 transition hover:border-blue-200 hover:shadow-sm">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="rounded-xl bg-blue-50 p-3 text-blue-600"><Icon size={21} /></div>
                                                        <div>
                                                            <h4 className="text-sm font-bold text-slate-900">{alarm.title}</h4>
                                                            <p className="mt-1 text-xs text-slate-400">Rule #{alarm.id.toString().padStart(2, "0")}</p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => toggleAlarm(alarm.id)}
                                                        aria-label={`Toggle ${alarm.title}`}
                                                        className={`relative h-6 w-11 shrink-0 rounded-full transition ${alarm.enabled ? "bg-blue-600" : "bg-slate-300"}`}
                                                    >
                                                        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${alarm.enabled ? "left-6" : "left-1"}`} />
                                                    </button>
                                                </div>
                                                <p className="mt-5 text-sm leading-relaxed text-slate-500">{alarm.description}</p>
                                                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                                                    <span className="flex items-center gap-2 text-xs text-slate-400"><Clock3 size={14} /> {alarm.condition}</span>
                                                    <span className={`flex items-center gap-1.5 text-xs font-semibold ${alarm.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                                                        <span className={`h-2 w-2 rounded-full ${alarm.enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
                                                        {alarm.enabled ? (alarmLive[alarm.id]?.alert ? "Alert" : "Monitoring") : "Paused"}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>

                            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                <div className="mb-5 flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-slate-900">Recent Activity</h3>
                                        <p className="mt-1 text-xs text-slate-400">Live monitoring status</p>
                                    </div>
                                    <button onClick={() => setActiveNav("Alert History")} className="text-xs font-semibold text-blue-600 hover:text-blue-800">View history →</button>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {activities.map((item) => (
                                        <div key={item.title} className="flex items-center gap-3 py-4">
                                            <div className={`rounded-lg p-2 ${item.type === "email" ? "bg-violet-50 text-violet-600" : item.type === "alert" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
                                                {item.type === "email" ? <Mail size={18} /> : <CheckCircle2 size={18} />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                                                <p className="mt-1 text-xs text-slate-400">{item.detail}</p>
                                            </div>
                                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.type === "alert" ? "bg-red-50 text-red-700" : item.type === "email" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{item.time}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <footer className="flex flex-col justify-between gap-2 border-t border-slate-200 py-5 text-xs text-slate-400 sm:flex-row">
                                <p>© 2026 CRO Automation. All rights reserved.</p>
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
