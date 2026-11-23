import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { EChartsOption } from "echarts";
import { Globe, Lightbulb, MonitorSmartphone, MousePointerClick, Share2, TrendingUp, X } from "lucide-react";
import EChart, { FONT, tipBase, useOceanTheme } from "../../components/EChart";
import { api, type LandingDeepDive as DeepData, type LandingDeepSplit, type LandingWindowMetrics, type LandingWindowName } from "../../services/api";
import InfoTip from "../../components/InfoTip";
import LandingPageDays from "./LandingPageDays";
import { Delta, fmtValue, pagePathLabel, type DeltaKind } from "./landingDelta";

// Deep dive for one landing page: WoW / MoM table of every metric, 60-day
// daily trend, traffic source / device / country splits, Clarity product page
// views and plain-language "what changed" notes. Opens as a side panel.

type Mode = "wow" | "mom";

const METRICS: { key: keyof LandingWindowMetrics; label: string; kind: DeltaKind; lowerIsBetter?: boolean; revenue?: boolean }[] = [
  { key: "sessions", label: "Sessions", kind: "count" },
  { key: "bounce_rate", label: "Bounce rate", kind: "rate", lowerIsBetter: true },
  { key: "added_to_cart_rate", label: "Add-to-cart rate", kind: "rate" },
  { key: "conversion_rate", label: "Conversion rate", kind: "rate" },
  { key: "orders", label: "Orders", kind: "count", revenue: true },
  { key: "revenue", label: "Revenue", kind: "money", revenue: true },
  { key: "revenue_per_session", label: "Revenue / session", kind: "money2", revenue: true },
  { key: "aov", label: "Avg order value", kind: "money2", revenue: true },
];

function Card({ icon, title, help, children, right }: { icon: ReactNode; title: string; help?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h4 className="font-bold text-slate-900">{title}{help && <InfoTip text={help} />}</h4>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="flex rounded-lg border bg-white p-0.5 text-xs">
      {(["wow", "mom"] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`rounded-md px-2.5 py-1 font-medium ${mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          {m === "wow" ? "WoW" : "MoM"}
        </button>
      ))}
    </div>
  );
}

function SplitTable({ rows, cur, prev, minSessions }: {
  rows: LandingDeepSplit[];
  cur: LandingWindowName;
  prev: LandingWindowName;
  minSessions: number;
}) {
  const total = rows.reduce((s, r) => s + (r[cur]?.sessions ?? 0), 0);
  const list = rows.filter((r) => (r[cur]?.sessions ?? 0) > 0 || (r[prev]?.sessions ?? 0) > 0);
  if (list.length === 0) return <p className="text-xs text-slate-400">No data for this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-slate-400">
            <th className="py-2 pr-3 font-medium">Segment</th>
            <th className="py-2 pr-3 text-right font-medium">Sessions</th>
            <th className="py-2 pr-3 text-right font-medium">Share</th>
            <th className="py-2 pr-3 text-right font-medium">Bounce</th>
            <th className="py-2 pr-3 text-right font-medium">Add to cart</th>
            <th className="py-2 text-right font-medium">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const c = r[cur], p = r[prev];
            const enough = (c?.sessions ?? 0) >= minSessions && (p?.sessions ?? 0) >= minSessions;
            return (
              <tr key={r.label} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-3 font-medium text-slate-800">{r.label}</td>
                <td className="py-2 pr-3 text-right">
                  <div className="tabular-nums text-slate-700">{(c?.sessions ?? 0).toLocaleString()}</div>
                  <Delta cur={c?.sessions} prev={p?.sessions} kind="count" />
                </td>
                <td className="py-2 pr-3 text-right text-slate-500">{total ? `${Math.round(((c?.sessions ?? 0) / total) * 1000) / 10}%` : "—"}</td>
                {(["bounce_rate", "added_to_cart_rate", "conversion_rate"] as const).map((k) => (
                  <td key={k} className="py-2 pr-3 text-right last:pr-0">
                    <div className="tabular-nums text-slate-700">{fmtValue(c?.[k], "rate", null)}</div>
                    <Delta cur={c?.[k]} prev={p?.[k]} kind="rate" lowerIsBetter={k === "bounce_rate"} enough={enough} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 7-day rolling, session-weighted rate (smooths out noisy single days). */
function rolling(daily: DeepData["daily"], key: "conversion_rate" | "bounce_rate" | "added_to_cart_rate", n = 7) {
  return daily.map((_, i) => {
    const win = daily.slice(Math.max(0, i - n + 1), i + 1);
    const s = win.reduce((a, d) => a + (d.sessions || 0), 0);
    if (!s || win.length < n) return null;
    return Math.round((win.reduce((a, d) => a + (d[key] ?? 0) * (d.sessions || 0), 0) / s) * 100) / 100;
  });
}

const niceMax = (vals: (number | null | undefined)[]) => {
  const m = Math.max(0, ...vals.filter((v): v is number => v != null));
  if (m <= 0) return 1;
  const step = m < 2 ? 0.5 : m < 5 ? 1 : m < 20 ? 5 : 10;
  return Math.ceil((m * 1.15) / step) * step;
};

function TrendChart({ daily }: { daily: DeepData["daily"] }) {
  const t = useOceanTheme();
  const dates = daily.map((d) => d.date.slice(5));
  const axisX = {
    type: "category" as const,
    data: dates,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 10 },
  };
  const pctTip = (ps: unknown) => {
    const arr = ps as { axisValue: string; seriesName: string; value: number | null; marker: string }[];
    return `<b>${arr[0]?.axisValue}</b><br/>` + arr
      .map((p) => `${p.marker}${p.seriesName}: <b>${p.value == null ? "—" : p.seriesName === "Sessions" ? Number(p.value).toLocaleString() : `${p.value}%`}</b>`)
      .join("<br/>");
  };

  // Chart 1: sessions + conversion, conversion on its OWN axis scaled to its
  // own range (0 - ~1.5%), so a 0.6% -> 0.9% move is clearly visible.
  const cvr7 = useMemo(() => rolling(daily, "conversion_rate"), [daily]);
  const convOption = useMemo<EChartsOption>(() => ({
    textStyle: { fontFamily: FONT },
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    tooltip: { trigger: "axis", ...tipBase(t), formatter: pctTip },
    xAxis: axisX,
    yAxis: [
      { type: "value", axisLabel: { color: t.muted, fontSize: 11 }, splitLine: { show: false } },
      {
        type: "value", min: 0,
        max: niceMax(daily.map((d) => d.conversion_rate)),
        axisLabel: { color: t.muted, fontSize: 11, formatter: "{value}%" }, splitLine: { lineStyle: { color: t.grid } },
      },
    ],
    series: [
      { name: "Sessions", type: "bar", data: daily.map((d) => d.sessions), barMaxWidth: 14, itemStyle: { color: t.seq[0], borderRadius: [3, 3, 0, 0] } },
      {
        name: "Conversion % (daily)", type: "line", yAxisIndex: 1, data: daily.map((d) => d.conversion_rate),
        symbol: "circle", symbolSize: 5, lineStyle: { width: 1.5, color: t.main, opacity: 0.55 }, itemStyle: { color: t.main },
      },
      {
        name: "Conversion % (7-day avg)", type: "line", yAxisIndex: 1, data: cvr7, smooth: true, symbol: "none",
        lineStyle: { width: 3.5, color: t.cat[4] }, itemStyle: { color: t.cat[4] },
      },
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [daily, cvr7, t]);

  // Chart 2: bounce and add-to-cart on their own scale.
  const rateOption = useMemo<EChartsOption>(() => ({
    textStyle: { fontFamily: FONT },
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    tooltip: { trigger: "axis", ...tipBase(t), formatter: pctTip },
    xAxis: axisX,
    yAxis: [
      { type: "value", scale: true, axisLabel: { color: t.mark, fontSize: 11, formatter: "{value}%" }, splitLine: { lineStyle: { color: t.grid } } },
      { type: "value", min: 0, max: niceMax(daily.map((d) => d.added_to_cart_rate)), axisLabel: { color: t.cat[2], fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } },
    ],
    series: [
      { name: "Bounce % (left)", type: "line", data: daily.map((d) => d.bounce_rate), smooth: true, symbol: "none", lineStyle: { width: 2, color: t.mark }, itemStyle: { color: t.mark } },
      { name: "Add to cart % (right)", type: "line", yAxisIndex: 1, data: daily.map((d) => d.added_to_cart_rate), smooth: true, symbol: "none", lineStyle: { width: 2, color: t.cat[2] }, itemStyle: { color: t.cat[2] } },
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [daily, t]);

  if (daily.length === 0) return <p className="text-xs text-slate-400">No daily data for this page.</p>;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-600">Sessions &amp; conversion rate <span className="font-normal text-slate-400">(conversion has its own scale on the right)</span></p>
        <EChart option={convOption} height={260} />
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-600">Bounce &amp; add-to-cart rate <span className="font-normal text-slate-400">(each on its own scale)</span></p>
        <EChart option={rateOption} height={180} />
      </div>
    </div>
  );
}

function LandingDeepDive({ path, currency, onClose, end = null }: { path: string; currency: string | null; onClose: () => void; end?: string | null }) {
  const [data, setData] = useState<DeepData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("wow");

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api.landingDeepDive(path, end)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Unable to load this page"));
    return () => {
      alive = false;
    };
  }, [path, end]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const cur: LandingWindowName = mode === "wow" ? "week" : "month";
  const prev: LandingWindowName = mode === "wow" ? "prev_week" : "prev_month";
  const metrics = METRICS.filter((m) => !m.revenue || data?.revenue_available);
  const weekEnough = data ? data.metrics.week.sessions >= data.min_week && data.metrics.prev_week.sessions >= data.min_week : false;
  const monthEnough = data ? data.metrics.month.sessions >= data.min_month && data.metrics.prev_month.sessions >= data.min_month : false;
  const clarity = data?.clarity;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      {/* Left side (wide screens): this page day by day, next to the deep dive */}
      <div className="hidden h-full min-w-0 flex-1 overflow-y-auto p-4 xl:block" onClick={(e) => e.stopPropagation()}>
        <LandingPageDays path={path} currency={currency} end={end} tall />
      </div>
      <div
        className="h-full w-full max-w-5xl overflow-y-auto bg-slate-50 p-4 shadow-2xl sm:p-6 xl:w-[56%] xl:max-w-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Deep dive: ${path}`}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">Landing page deep dive</p>
            <h3 className="truncate text-xl font-bold text-slate-900" title={path}>{pagePathLabel(path)}</h3>
            {data && (
              <p className="mt-1 text-xs text-slate-500">
                <span className="mr-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">{data.page_type}</span>
                This week {data.windows.week.label} · Last 30 days {data.windows.month.label} · today left out
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg border bg-white p-2 text-slate-500 hover:text-slate-800" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {!data && !error && <p className="text-sm text-slate-400">Loading this page from Shopify…</p>}

        {data && (
          <div className="space-y-5">
            {data.insights.length > 0 && (
              <Card icon={<Lightbulb className="text-amber-500" size={18} />} title="What changed">
                <ul className="space-y-1.5 text-sm">
                  {data.insights.map((n, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.tone === "good" ? "bg-emerald-500" : n.tone === "bad" ? "bg-red-500" : "bg-blue-400"}`} />
                      <span className="text-slate-700">{n.text}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card
              icon={<TrendingUp className="text-blue-500" size={18} />}
              title="Week on week & month on month"
              help={`WoW = ${data.windows.week.label} vs ${data.windows.prev_week.label}. MoM = ${data.windows.month.label} vs ${data.windows.prev_month.label}. Rate changes are marked 'low data' when either window has fewer than ${data.min_week} (week) / ${data.min_month} (month) sessions.`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-400">
                      <th className="py-2 pr-3 font-medium">Metric</th>
                      <th className="py-2 pr-3 text-right font-medium">This week</th>
                      <th className="py-2 pr-3 text-right font-medium">Last week</th>
                      <th className="py-2 pr-3 text-right font-medium">WoW</th>
                      <th className="border-l py-2 pl-3 pr-3 text-right font-medium">Last 30 days</th>
                      <th className="py-2 pr-3 text-right font-medium">Previous 30</th>
                      <th className="py-2 text-right font-medium">MoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => {
                      const v = data.metrics;
                      const isCount = m.key === "sessions" || m.key === "orders" || m.key === "revenue";
                      return (
                        <tr key={m.key} className="border-b border-slate-50 last:border-0">
                          <td className="py-2 pr-3 font-medium text-slate-700">{m.label}</td>
                          <td className="py-2 pr-3 text-right font-semibold tabular-nums text-slate-900">{fmtValue(v.week[m.key], m.kind, currency)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{fmtValue(v.prev_week[m.key], m.kind, currency)}</td>
                          <td className="py-2 pr-3 text-right">
                            <Delta cur={v.week[m.key]} prev={v.prev_week[m.key]} kind={m.kind} currency={currency} lowerIsBetter={m.lowerIsBetter} enough={isCount || weekEnough} />
                          </td>
                          <td className="border-l py-2 pl-3 pr-3 text-right font-semibold tabular-nums text-slate-900">{fmtValue(v.month[m.key], m.kind, currency)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{fmtValue(v.prev_month[m.key], m.kind, currency)}</td>
                          <td className="py-2 text-right">
                            <Delta cur={v.month[m.key]} prev={v.prev_month[m.key]} kind={m.kind} currency={currency} lowerIsBetter={m.lowerIsBetter} enough={isCount || monthEnough} />
                          </td>
                        </tr>
                      );
                    })}
                    {clarity?.available && (
                      <tr className="border-b border-slate-50 last:border-0">
                        <td className="py-2 pr-3 font-medium text-slate-700">Product page views (Clarity)</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums text-slate-900">{fmtValue(clarity.week, "count", null)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{fmtValue(clarity.prev_week, "count", null)}</td>
                        <td className="py-2 pr-3 text-right"><Delta cur={clarity.week} prev={clarity.prev_week} kind="count" /></td>
                        <td className="border-l py-2 pl-3 pr-3 text-right font-semibold tabular-nums text-slate-900">{fmtValue(clarity.month, "count", null)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{fmtValue(clarity.prev_month, "count", null)}</td>
                        <td className="py-2 text-right"><Delta cur={clarity.month} prev={clarity.prev_month} kind="count" /></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="cro-note mt-2 text-xs text-slate-400">
                Revenue = sales of orders whose visit started on this page.
                {clarity && !clarity.available && " Clarity product views will show here once Clarity snapshots are saved."}
                {clarity?.available && " Clarity views count all visits that opened this product page (not only landings), bots removed."}
              </p>
            </Card>

            <div className="xl:hidden"><LandingPageDays path={path} currency={currency} end={end} /></div>

            <Card icon={<TrendingUp className="text-blue-500" size={18} />} title="Daily trend (last 60 days)" help="Top chart: sessions (bars) and conversion rate on its own zoomed-in scale. Thin line = each day, thick pink line = 7-day average (smooths out noisy days). Bottom chart: bounce and add-to-cart rate.">
              <TrendChart daily={data.daily} />
            </Card>

            <Card
              icon={<Share2 className="text-blue-500" size={18} />}
              title="Traffic sources for this page"
              help="Where visitors to this page came from, and how each source's bounce and conversion moved."
              right={<ModeToggle mode={mode} setMode={setMode} />}
            >
              <p className="mb-2 text-xs text-slate-400">{data.windows[cur].label} vs {data.windows[prev].label}</p>
              <SplitTable rows={data.sources} cur={cur} prev={prev} minSessions={30} />
            </Card>

            <Card
              icon={<MonitorSmartphone className="text-blue-500" size={18} />}
              title="Devices for this page"
              right={<ModeToggle mode={mode} setMode={setMode} />}
            >
              <p className="mb-2 text-xs text-slate-400">{data.windows[cur].label} vs {data.windows[prev].label}</p>
              <SplitTable rows={data.devices} cur={cur} prev={prev} minSessions={30} />
            </Card>

            <Card icon={<Globe className="text-blue-500" size={18} />} title="Top countries (month on month)">
              <p className="mb-2 text-xs text-slate-400">{data.windows.month.label} vs {data.windows.prev_month.label}</p>
              <SplitTable rows={data.countries} cur="month" prev="prev_month" minSessions={30} />
            </Card>

            {data.page_type.toLowerCase().includes("product") && !clarity?.available && (
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <MousePointerClick size={14} /> Scroll depth and click data per page are in Microsoft Clarity (heatmaps / recordings) for this URL.
              </p>
            )}

            {Object.keys(data.errors).length > 0 && (
              <p className="text-xs text-slate-400">
                Some parts couldn't load from Shopify: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join("; ")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default LandingDeepDive;
