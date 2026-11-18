
import { useCallback, useEffect, useState } from "react";
import { api, formatMoney, timeAgo, type CvrDay, type DashboardSummary } from "../../services/api";
import AlarmRules from "../alarms/AlarmRules";
import AlertHistory from "../alarms/AlertHistory";
import SettingsPage from "../settings/Settings";
import {
    Activity, ArrowUpRight,
    Bell, CheckCircle2, Clock3, LayoutDashboard,
    Mail, Menu, RefreshCw, Settings, ShieldCheck,
    ShoppingBag, TrendingUp, X
} from "lucide-react";
import {
    Area, AreaChart, CartesianGrid, ResponsiveContainer,
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

    // ---- Real data from backend ----
    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [trend, setTrend] = useState<CvrDay[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const periodDays = period === "Last 30 days" ? 30 : 7;

    const loadData = useCallback(async () => {
        setError(null);
        try {
            const [s, t] = await Promise.all([
                api.summary(),
                api.cvrTrend(periodDays).catch(() => ({ store_id: 0, days: [] as CvrDay[] })),
            ]);
            setSummary(s);
            setTrend(t.days);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load dashboard data");
        } finally {
            setLoading(false);
        }
    }, [periodDays]);

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

    const navItems = [
        { name: "Overview", icon: LayoutDashboard },
        { name: "Alarm Rules", icon: Bell },
        { name: "Alert History", icon: Activity },
        { name: "Settings", icon: Settings },
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

                    <div className="px-5 pt-8">
                        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[2px] text-slate-500">Workspace</p>
                        <nav className="space-y-2">
                            {navItems.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <button
                                        key={item.name}
                                        onClick={() => {
                                            setActiveNav(item.name);
                                            setMobileMenu(false);
                                        }}
                                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${activeNav === item.name ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
                                    >
                                        <Icon size={19} />
                                        {item.name}
                                        {item.name === "Alarm Rules" && (
                                            <span className="ml-auto rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">02</span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>

                    <div className="mt-auto p-5">
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

                        <div className={`mx-auto max-w-[1500px] space-y-7 p-5 sm:p-8 ${activeNav === "Alarm Rules" || activeNav === "Alert History" || activeNav === "Settings" ? "hidden" : ""}`}>

                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                                <div>
                                    <p className="text-sm text-slate-500">Welcome to your monitoring workspace</p>
                                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">CRO Performance Overview</h1>
                                    <p className="mt-2 text-sm text-slate-500">Monitor your store performance and automated alerts.</p>
                                </div>
                                <button onClick={refreshNow} disabled={syncing} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-60">
                                    <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing Shopify…" : "Refresh Dashboard"}
                                </button>
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

                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                {[
                                    {
                                        label: "Quilt Orders Today",
                                        value: loading ? "…" : String(summary?.today.quilt_orders ?? "—"),
                                        change: `${pct(summary?.changes.quilt_orders_pct)} vs same time yday`,
                                        icon: ShoppingBag, color: "blue",
                                        note: summary ? `Yesterday: ${summary.yesterday.quilt_orders} quilt orders (store time)` : "Loading…",
                                    },
                                    {
                                        label: "Conversion Rate",
                                        value: loading ? "…" : cvr?.yesterday_cvr != null ? `${cvr.yesterday_cvr}%` : "—",
                                        change: cvrDiff === null ? "—" : `${cvrDiff > 0 ? "+" : ""}${cvrDiff} pts`,
                                        icon: TrendingUp, color: "violet",
                                        note: cvr ? `Yesterday (${cvr.yesterday_date}) vs ${cvr.previous_cvr ?? "—"}% day before` : summary?.cvr_error ? "Shopify analytics unavailable" : "Loading…",
                                    },
                                    {
                                        label: "Orders Today",
                                        value: loading ? "…" : String(summary?.today.orders ?? "—"),
                                        change: `${pct(summary?.changes.orders_pct)} vs same time yday`,
                                        icon: Activity, color: "emerald",
                                        note: summary ? `Revenue ${formatMoney(summary.today.revenue, currency)} · Yesterday ${summary.yesterday.orders} orders / ${formatMoney(summary.yesterday.revenue, currency)}` : "Loading…",
                                    },
                                    {
                                        label: "Open Alerts",
                                        value: loading ? "…" : String(summary?.open_alerts ?? 0),
                                        change: `${summary?.active_rules ?? 0} rules active`,
                                        icon: Bell, color: "amber",
                                        note: "Email delivery setup pending",
                                    },
                                ].map((item) => {
                                    const Icon = item.icon;
                                    const colors: Record<string, string> = {
                                        blue: "bg-blue-50 text-blue-600",
                                        violet: "bg-violet-50 text-violet-600",
                                        emerald: "bg-emerald-50 text-emerald-600",
                                        amber: "bg-amber-50 text-amber-600",
                                    };
                                    return (
                                        <div key={item.label} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm font-medium text-slate-500">{item.label}</p>
                                                <div className={`rounded-xl p-2.5 ${colors[item.color]}`}><Icon size={20} /></div>
                                            </div>
                                            <div className="mt-4 flex items-end justify-between">
                                                <h3 className="text-3xl font-bold tracking-tight text-slate-900">{item.value}</h3>
                                                <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-emerald-600">
                                                    <ArrowUpRight size={14} /> {item.change}
                                                </span>
                                            </div>
                                            <p className="mt-2 text-xs text-slate-400">{item.note}</p>
                                        </div>
                                    );
                                })}
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
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
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
