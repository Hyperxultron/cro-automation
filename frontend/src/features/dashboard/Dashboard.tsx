
import { useCallback, useEffect, useState } from "react";
import {
    api, formatMoney, timeAgo,
    type AlarmRuleItem, type ChangeLogEntry, type CvrDay, type DashboardSummary, type FunnelCompare, type OrderHealth, type Overview, type OrdersTrendDay, type SalesBreakdown, type SalesTrend, type TopProduct
} from "../../services/api";
import ChangeLog from "../changelog/ChangeLog";
import AlarmRules from "../alarms/AlarmRules";
import AlertHistory from "../alarms/AlertHistory";
import SettingsPage from "../settings/Settings";
import StoreIntegration from "../store/StoreIntegration";
import CroRecommendations from "../recommendations/CroRecommendations";
import ConversionAnalytics from "../analytics/ConversionAnalytics";
import ProductAnalytics from "../analytics/ProductAnalytics";
import LandingPages from "../analytics/LandingPages";
import SiteHealth from "../analytics/SiteHealth";
import CartCheckoutAnalytics from "../analytics/CartCheckoutAnalytics";
import FunnelBars from "../analytics/FunnelBars";
import InfoTip from "../../components/InfoTip";
import { HELP } from "../../components/helpText";
import ComingSoon from "../misc/ComingSoon";
import {
    Activity, ArrowDownRight, ArrowUpRight,
    Bell, CheckCircle2, Clock3, DollarSign, FileText, Gauge, Globe, History, IndianRupee, LayoutDashboard,
    Lightbulb, Mail, Menu, Package, RefreshCw, Route, Settings, ShieldCheck,
    ShoppingBag, ShoppingCart, TrendingUp, Users, X
} from "lucide-react";
import {
    Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
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
const moneyChangeBothWays = (absValue: number | null, pctValue: number | null, currency?: string | null) => {
    if (absValue === null || pctValue === null) return "—";
    const sign = absValue > 0 ? "+" : absValue < 0 ? "-" : "";
    return `${sign}${formatMoney(Math.abs(absValue), currency)} (${pctValue > 0 ? "+" : ""}${pctValue}%)`;
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

// Which live check belongs to which alarm rule (rules now come from the backend,
// not a hardcoded list - so the Overview can't show a rule that doesn't exist).
const ruleKind = (rule: AlarmRuleItem): "quilt" | "cvr" | "other" => {
    const t = rule.title.toLowerCase();
    if (t.includes("quilt")) return "quilt";
    if (t.includes("conversion") || t.includes("cvr")) return "cvr";
    return "other";
};

function Dashboard() {
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
    const [ordersTrend, setOrdersTrend] = useState<OrdersTrendDay[]>([]);
    const [funnel, setFunnel] = useState<FunnelCompare | null>(null);
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
            const [s, t, tp, ot, oh, ov, cl, st, sb, ar] = await Promise.all([
                api.summary(),
                // 2x the window: the earlier half is the dashed "previous period" line.
                api.cvrTrend(periodDays * 2).catch(() => ({ store_id: 0, days: [] as CvrDay[] })),
                api.topProducts(1, 5).catch(() => ({ days: 1, products: [] as TopProduct[] })),
                api.ordersTrend(7).catch(() => ({ days: 7, trend: [] as OrdersTrendDay[] })),
                api.orderHealth(30).catch(() => null),
                api.overview(overviewPeriod, overviewCompare).catch(() => null),
                api.changeLog(Math.max(periodDays, 28)).catch(() => ({ days: 0, valid_areas: [], entries: [] as ChangeLogEntry[] })),
                api.salesTrend(14).catch(() => null),
                api.salesBreakdown(overviewPeriod, overviewCompare).catch(() => null),
                api.alarmRules().catch(() => [] as AlarmRuleItem[]),
            ]);
            setSummary(s);
            setTrend(t.days);
            setTopProducts(tp.products);
            setOrdersTrend(ot.trend);
            setOrderHealth(oh);
            setOverview(ov);
            setChangeLogEntries(cl.entries);
            setSalesTrend(st);
            setSalesBreakdown(sb);
            setAlarmRules(ar);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load dashboard data");
        } finally {
            setLoading(false);
        }
    }, [periodDays, overviewPeriod, overviewCompare]);

    // Conversion Funnel card has its own Today / Yesterday / Last 7 switch; it
    // follows the Overview period picker when that changes.
    const [funnelPeriod, setFunnelPeriod] = useState<"today" | "yesterday" | "last7">("yesterday");
    const [funnelLoading, setFunnelLoading] = useState(true);
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
        current: d.revenue,
        previous: salesTrend?.previous[i]?.revenue ?? null,
    }));
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

    const quiltStatusText: Record<string, string> = {
        normal: "Normal",
        alarm_triggered: "ALERT",
        alarm_active: "ALERT",
        no_quilt_orders_yet: "No quilt orders yet",
        no_quilt_products: "No quilt products",
        no_active_rule: "No active quilt rule",
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

    const quiltRuleOff = quilt?.status === "no_active_rule";
    const activeRuleCount = alarmRules.filter((r) => r.is_active).length;
    const activities = summary
        ? [
              {
                  title: "Quilt orders monitoring",
                  detail: alarmLive[1].text,
                  time: quiltAlert ? "Alert" : quiltRuleOff ? "Off" : quilt?.status === "normal" ? "Normal" : "Active",
                  type: quiltAlert ? "alert" : quiltRuleOff ? "email" : "monitor",
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
                            <p className="text-2xl font-bold">{activeRuleCount} / {alarmRules.length}</p>
                            <p className="mt-1 text-xs text-slate-400">Alarm rules enabled</p>
                            <div className="mt-4 h-1.5 rounded-full bg-white/10">
                                <div className="h-full rounded-full bg-blue-500" style={{ width: `${alarmRules.length ? (activeRuleCount / alarmRules.length) * 100 : 0}%` }} />
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

                            {/* "How to read this page" - so a new team member can follow the
                                dashboard without help (manager's 15-minute goal). */}
                            <details className="group rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-600">
                                <summary className="cursor-pointer select-none font-semibold text-blue-800">How to read this page (1 minute)</summary>
                                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
                                    <li><b>Pick a period</b> at the top. "Yesterday" is a full day and is the default; "Today so far" is still filling up.</li>
                                    <li><b>Check the health strip</b>: if the last order was many hours ago during US daytime, something may be broken.</li>
                                    <li><b>Read the cards left to right</b>: Revenue → Conversion rate → Orders. Each card says its period and what it's compared with (the same weekday in earlier weeks).</li>
                                    <li><b>Colours mean good or bad, not up or down.</b> Green = good for the store, red = needs attention. Grey "Too early to compare" = not enough data yet to trust a % change.</li>
                                    <li><b>Find where it changed</b> in the Conversion Funnel: the step with the red number is where shoppers dropped off more than usual. Then open Conversion Analytics for the device and channel split.</li>
                                    <li>Tap any <span className="inline-flex align-middle text-slate-400">ⓘ</span> to see exactly what a number means. Numbers come from Shopify and match Shopify Analytics' definitions.</li>
                                </ol>
                            </details>

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
                                    <div className="rounded-lg bg-blue-50 p-2 text-blue-600"><RefreshCw size={16} /></div>
                                    <div>
                                        <p className="text-xs text-slate-400">Orders copied from Shopify</p>
                                        <p className="text-sm font-semibold text-slate-800">
                                            {overview?.health.last_synced_at ? timeAgo(overview.health.last_synced_at) : loading ? "Loading…" : "Not yet"}
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
                            {overview?.warnings?.map((w) => (
                                <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    {w}
                                </div>
                            ))}
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

                                    const renderChange = (m: typeof revenueMetric, absUnit: string, money = false) => {
                                        if (!m) return { text: loading ? "Loading…" : "—", tone: "slate", showArrow: false };
                                        if (m.too_early) return { text: "Too early to compare", tone: "slate", showArrow: false };
                                        if (m.baseline_value === null) return { text: "No history yet", tone: "slate", showArrow: false };
                                        const text = money
                                            ? moneyChangeBothWays(m.change_abs, m.change_pct, currency)
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
                                    const cards: {
                                        label: string; period: string; value: string; icon: typeof Bell; color: string;
                                        change: { text: string; tone: string; showArrow: boolean }; note: string;
                                        spark?: (number | null)[]; help: string;
                                    }[] = [
                                        {
                                            label: "Revenue", help: HELP.revenue,
                                            period: periodLabel,
                                            value: loading ? "…" : revenueMetric?.value != null ? formatMoney(revenueMetric.value, currency) : "—",
                                            icon: MoneyIcon, color: "rose",
                                            change: renderChange(revenueMetric, "", true),
                                            spark: revenueSpark,
                                            note: aovMetric?.value != null
                                                ? `AOV ${formatMoney(aovMetric.value, currency)} · ${baselineNote(revenueMetric, (v) => formatMoney(v, currency))}`
                                                : "Loading…",
                                        },
                                        {
                                            label: "Quilt Orders Today", help: HELP.quiltOrders,
                                            period: "Today",
                                            value: loading ? "…" : String(summary?.today.quilt_orders ?? "—"),
                                            // Quilt volume (a handful a day) is always below the ~20-order
                                            // threshold, so a % change here would be noise.
                                            change: { text: summary ? "Too early to compare" : "—", tone: "slate", showArrow: false },
                                            icon: ShoppingBag, color: "blue",
                                            note: summary ? `Yesterday: ${summary.yesterday.quilt_orders} quilt orders (store time)` : "Loading…",
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
                                            label: "Orders", help: HELP.orders,
                                            period: periodLabel,
                                            value: loading ? "…" : ordersMetric?.value != null ? String(ordersMetric.value) : "—",
                                            icon: Activity, color: "emerald",
                                            change: renderChange(ordersMetric, ""),
                                            spark: ordersSpark,
                                            note: baselineNote(ordersMetric, (v) => String(v)),
                                        },
                                        {
                                            label: "Open Alerts", help: HELP.openAlerts,
                                            period: "Now",
                                            value: loading ? "…" : String(summary?.open_alerts ?? 0),
                                            change: { text: "", tone: "slate", showArrow: false },
                                            icon: Bell, color: "amber",
                                            note: `${activeRuleCount} ${activeRuleCount === 1 ? "rule" : "rules"} active · email delivery setup pending`,
                                        },
                                    ];

                                    const colors: Record<string, string> = {
                                        blue: "bg-blue-50 text-blue-600",
                                        violet: "bg-violet-50 text-violet-600",
                                        emerald: "bg-emerald-50 text-emerald-600",
                                        amber: "bg-amber-50 text-amber-600",
                                        rose: "bg-rose-50 text-rose-600",
                                    };
                                    const sparkColor: Record<string, string> = {
                                        rose: "#f43f5e", violet: "#8b5cf6", emerald: "#10b981", blue: "#3b82f6",
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
                                                        <p className="text-sm font-medium text-slate-500">{item.label}<InfoTip text={item.help} /></p>
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
                                                {item.spark && <Sparkline values={item.spark} color={sparkColor[item.color] ?? "#94a3b8"} />}
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
                                            <h3 className="font-bold text-slate-900">Total Sales Over Time<InfoTip text={HELP.salesOverTime} /></h3>
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
                                    {historyStartLabel && (!salesCurrentComplete || !salesPrevComplete) && (
                                        <p className="mb-2 text-xs text-amber-600">Order history in this app starts {historyStartLabel}; earlier days are blank, not $0.</p>
                                    )}
                                    <div className="h-64 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={salesChartData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf0f5" />
                                                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                                                    formatter={(value, name) => [formatMoney(Number(value) || 0, currency), name === "current" ? "This period" : "Previous period"]}
                                                />
                                                <Line type="linear" dataKey="previous" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
                                                <Line type="linear" dataKey="current" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                                                {salesMarkers.map((m) => (
                                                    <ReferenceLine key={m.id} x={m.label} stroke="#f59e0b" strokeDasharray="4 3"
                                                        label={{ value: "●", position: "top", fill: "#f59e0b", fontSize: 10 }} />
                                                ))}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <p className="mt-2 text-xs text-slate-400">Solid line with dots: this period · dashed: the {salesTrend?.days ?? 14} days before</p>
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
                                        <p className="mt-3 text-xs text-slate-400">Too early to compare - below the usual order threshold for this period.</p>
                                    )}
                                    {salesBreakdown && !salesBreakdown.too_early && salesBreakdown.rows.every((r) => r.baseline_value === null) && (
                                        <p className="mt-3 text-xs text-slate-400">No comparison yet - not enough order history for {salesBreakdown.rows[0]?.baseline_label.replace(/^vs /, "the ")}.</p>
                                    )}
                                    {salesBreakdown && !salesBreakdown.too_early && salesBreakdown.rows[0]?.baseline_value !== null && (
                                        <p className="mt-3 text-xs text-slate-400">Changes are {salesBreakdown.rows[0]?.baseline_label}.</p>
                                    )}
                                    <p className="mt-3 text-xs text-slate-400">{salesBreakdown?.note}</p>
                                </section>
                            </div>

                            <div className="grid gap-6 xl:grid-cols-3">
                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:col-span-2 sm:p-6">
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
                                    <p className="mt-2 text-xs text-slate-400">Solid line with dots: last {periodDays} days · dashed: the {periodDays} days before</p>
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
                                            <h3 className="font-bold text-slate-900">Alarm Overview<InfoTip text={HELP.alarms} /></h3>
                                            <p className="mt-1 text-xs text-slate-400">Your automation rules</p>
                                        </div>
                                        <Bell className="text-blue-500" size={21} />
                                    </div>
                                    <div className="mt-7 space-y-5">
                                        {alarmRules.length === 0 && (
                                            <p className="text-xs text-slate-400">{loading ? "Loading…" : "No alarm rules set up yet."}</p>
                                        )}
                                        {alarmRules.map((rule) => {
                                            const kind = ruleKind(rule);
                                            const Icon = kind === "quilt" ? ShoppingBag : kind === "cvr" ? TrendingUp : Bell;
                                            const live = kind === "quilt" ? alarmLive[1] : kind === "cvr" ? alarmLive[2] : undefined;
                                            return (
                                                <div key={rule.id} className="flex items-start gap-3">
                                                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><Icon size={20} /></div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-semibold text-slate-800">{rule.title}</p>
                                                        {rule.description && <p className="mt-1 text-xs text-slate-400">{rule.description}</p>}
                                                        {summary && rule.is_active && live && (
                                                            <p className={`mt-1 text-xs ${live.alert ? "font-semibold text-red-600" : "text-slate-500"}`}>{live.text}</p>
                                                        )}
                                                        <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${rule.is_active ? (live?.alert ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700") : "bg-slate-100 text-slate-500"}`}>
                                                            {rule.is_active ? (live?.alert ? "Alert" : "Enabled") : "Paused"}
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
                                            <h3 className="font-bold text-slate-900">Top Selling Products<InfoTip text={HELP.topProducts} /></h3>
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

                                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-bold text-slate-900">Conversion Funnel<InfoTip text={HELP.funnel} /></h3>
                                            <p className="mt-1 text-xs text-slate-400">{funnel?.period_label ?? "Loading…"}</p>
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
                                                    className={`rounded-md px-2 py-1 font-medium ${funnelPeriod === opt.key ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <FunnelBars data={funnel} loading={funnelLoading} compact />
                                </section>
                            </div>

                            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
                                <div className="mb-5 flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-slate-900">Order Health<InfoTip text={HELP.orderHealth} /></h3>
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
