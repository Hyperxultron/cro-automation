// Backend API calls (real Shopify data)

const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const API_KEY = import.meta.env.VITE_DASHBOARD_API_KEY as string | undefined;

export type OrderStats = { orders: number; revenue: number; aov: number; quilt_orders: number };

export type QuiltAlarm = {
  status: string;
  store_id?: number;
  last_quilt_order_number?: string;
  last_quilt_order_at?: string;
  hours_elapsed?: number;
  threshold_hours?: number;
  alert_id?: number;
};

export type TopProduct = { name: string; category: string | null; quantity: number; revenue: number };

export type OrdersTrendDay = OrderStats & { date: string };

export type Funnel = {
  date: string | null;
  sessions: number;
  added_to_cart: number;
  reached_checkout: number;
  completed_checkout: number;
  cart_rate: number | null;
  checkout_rate: number | null;
  conversion_rate: number | null;
};

export type CvrComparison = {
  yesterday_date: string;
  yesterday_cvr: number | null;
  previous_date: string;
  previous_cvr: number | null;
  drop_percent: number | null;
};

export type DashboardSummary = {
  store: {
    id: number;
    name: string;
    domain: string;
    timezone: string | null;
    currency: string | null;
    last_synced_at: string | null;
  };
  today: OrderStats;
  yesterday: OrderStats;
  yesterday_same_time: OrderStats;
  changes: { orders_pct: number | null; quilt_orders_pct: number | null };
  cvr: CvrComparison | null;
  cvr_error: string | null;
  quilt_alarm: QuiltAlarm;
  active_rules: number;
  open_alerts: number;
};

export type CvrDay = { date: string; sessions: number; cvr: number | null };

export type AlertItem = {
  id: number;
  rule: string | null;
  message: string;
  status: string;
  triggered_at: string | null;
  resolved_at: string | null;
};

export type AlarmRuleItem = {
  id: number;
  title: string;
  description: string | null;
  threshold: number | null;
  is_active: boolean;
  last_checked_at: string | null;
  last_triggered_at: string | null;
  live_status: string | null;
};

export type SettingsData = {
  store_name: string;
  store_domain: string;
  timezone: string | null;
  currency: string | null;
  notification_email: string | null;
  email_alerts_enabled: boolean;
  smtp_configured: boolean;
};

export type StoreInfo = {
  id: number;
  name: string;
  domain: string;
  platform: string;
  timezone: string | null;
  currency: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  auth_method: string;
};

export type ProductPerformance = TopProduct & { performance_status: "top" | "average" | "low" };

export type ProductGroup = "star" | "hidden_gem" | "leaky" | "dead_weight";

export type ProductRow = {
  product_id: number;
  name: string;
  category: string;
  orders: number;
  quantity: number;
  revenue: number;
  price: number | null;
  prior_revenue: number;
  revenue_change_pct: number | null;
  is_new?: boolean;
  views: number | null;
  cart_adds: number | null;
  add_to_cart_rate?: number | null;
  cart_to_purchase_rate?: number | null;
  revenue_per_view?: number | null;
  view_to_purchase_rate?: number | null;
  view_orders?: number;
  adjusted_rate?: number;
  category_rate?: number;
  vs_category_pts?: number;
  group?: ProductGroup;
  revenue_left_on_table?: number;
  gross_sales?: number;
  discounts?: number;
  net_sales?: number;
};

export type CategoryRow = {
  category: string;
  products: number;
  items: number;
  orders: number;
  revenue: number;
  prior_revenue: number;
  revenue_change_pct: number | null;
  is_new?: boolean;
};

export type ProductAnalyticsData = {
  days: number;
  window_label: string;
  prior_window_label: string;
  sales_source: "shopify" | "orders_db";
  sales_note: string;
  views_available: boolean;
  views_source?: "clarity" | null;
  views_days?: number;
  views_window_label?: string | null;
  views_note: string | null;
  products: ProductRow[];
  categories: CategoryRow[];
  fix_first: ProductRow[];
};

export type FunnelTrendDay = Funnel & {
  cart_abandonment_rate: number | null;
  checkout_abandonment_rate: number | null;
};

export type Recommendation = {
  title: string;
  explanation: string;
  evidence: string;
  priority: "High" | "Medium" | "Low";
  suggested_action: string;
  affected_metric: string;
};

export type Benchmark = { value: number; label: string; source: string };
export type Benchmarks = {
  cart_abandonment_rate: Benchmark;
  checkout_abandonment_rate: Benchmark;
  conversion_rate: Benchmark;
};

export type OverviewMetric = {
  value: number | null;
  baseline_value: number | null;
  baseline_label: string;
  change_abs: number | null;
  change_pct: number | null;
  too_early: boolean;
  sessions?: number | null;
  base_label?: string;
};

export type Overview = {
  period: "yesterday" | "today" | "last7";
  period_label: string;
  compare: "4week_avg" | "last_week";
  history_start: string | null;
  is_partial: boolean;
  timezone: string;
  as_of: string;
  metrics: {
    orders: OverviewMetric;
    revenue: OverviewMetric;
    aov: OverviewMetric;
    conversion_rate: OverviewMetric;
  };
  health: {
    last_order_at: string | null;
    last_synced_at?: string | null;
    mobile_page_speed: number | null;
    mobile_page_speed_status: "not_available" | "ok";
  };
  cvr_error: string | null;
  warnings: string[];
};

export type SegmentRow = {
  label: string;
  sessions: number;
  added_to_cart_rate: number | null;
  conversion_rate: number | null;
  orders: number;
  baseline_sessions: number | null;
  baseline_conversion_rate: number | null;
  sessions_change_pct: number | null;
  conversion_rate_change_pts: number | null;
  // Channel split only (null for device - Shopify's sales data has no device dimension).
  revenue: number | null;
  aov: number | null;
  revenue_per_session: number | null;
  baseline_revenue_per_session: number | null;
  revenue_per_session_change_pct: number | null;
};

export type FunnelStep = {
  key: "sessions" | "product_views" | "added_to_cart" | "reached_checkout" | "completed_checkout";
  label: string;
  available: boolean;
  value: number | null;
  pct_of_sessions: number | null;
  step_pct: number | null;
  previous_value: number | null;
  previous_step_pct: number | null;
  step_change_pts: number | null;
};

export type LandingRange = "today" | "yesterday" | 7 | 28;

export type FunnelCompare = {
  period: "today" | "yesterday" | "last7";
  period_label: string;
  compare_label: string;
  product_views_available: boolean;
  too_early: boolean;
  steps: FunnelStep[];
};

export type LandingSplitRow = {
  label: string;
  sessions: number;
  bounce_rate: number | null;
  added_to_cart_rate: number | null;
  conversion_rate: number | null;
  previous_sessions: number | null;
  previous_bounce_rate: number | null;
  bounce_change_pts: number | null;
  previous_conversion_rate: number | null;
  conversion_change_pts: number | null;
  too_few_sessions: boolean;
  share_of_sessions?: number | null;
};

export type LandingPageRow = Omit<LandingSplitRow, "label" | "share_of_sessions"> & {
  path: string;
  page_type: string;
  revenue: number | null;
  orders: number | null;
  revenue_per_session: number | null;
  top_source: string | null;
  top_source_share: number | null;
  bounce_flag: boolean;
};

export type LandingPagesData = {
  days: number;
  window_label: string;
  compare_label: string;
  bounce_definition: string;
  min_sessions: number;
  bounce_flag_pts: number;
  revenue_available: boolean;
  revenue_note: string;
  pages: LandingPageRow[];
  page_types: LandingSplitRow[];
  by_source: LandingSplitRow[];
  by_device: LandingSplitRow[];
  errors: Record<string, string>;
};

export type VitalRating = "good" | "needs_improvement" | "poor" | null;

export type Vital = {
  p75: number | null;
  rating: VitalRating;
  good_share: number | null;
  poor_share: number | null;
  previous_p75?: number | null;
  change?: number | null;
};

export type VitalsRow = { page_loads: number; lcp: Vital; inp: Vital; cls: Vital };

export type SiteHealthData = {
  days: number;
  window_label: string;
  compare_label: string;
  speed_window_label?: string;
  speed_note?: string | null;
  search_window_label?: string;
  search_note?: string | null;
  limits: Record<"lcp" | "inp" | "cls", { good: number; poor: number; unit: string }>;
  cwv_available: boolean;
  devices: Record<string, VitalsRow>;
  page_types: (VitalsRow & { label: string })[];
  pages: (VitalsRow & { path: string })[];
  trend: { date: string; page_loads: number; lcp_s: number | null; inp_ms: number | null; cls: number | null }[];
  search: {
    sessions_with_searches: number;
    share_of_sessions: number | null;
    searcher_conversion_rate: number | null;
    non_searcher_conversion_rate: number | null;
    search_added_to_cart_rate: number;
    search_click_rate: number;
    searches: number | null;
    zero_result_searches: number | null;
    zero_result_share: number | null;
    top_terms: { term: string; searches: number; click_rate: number | null }[];
    zero_result_terms: { term: string; searches: number }[];
  } | null;
  not_available: string[];
  errors: Record<string, string>;
};

export type PaymentRow = {
  label: string;
  attempts: number;
  successful: number;
  failed_attempts: number;
  authorization_rate: number | null;
  share_of_payments: number | null;
};

export type CartExtras = {
  days: number;
  window_label: string;
  payments: {
    methods: PaymentRow[];
    wallets: PaymentRow[];
    attempts: number;
    successful: number;
    failed_attempts: number;
    authorization_rate: number | null;
  } | null;
  payments_error: string | null;
  order_values: {
    orders: number;
    average: number | null;
    median: number | null;
    bars: { from: number; label: string; orders: number; share: number; below_threshold_zone: boolean }[];
    threshold: number | null;
    near_threshold_orders: number | null;
    near_threshold_share: number | null;
    near_threshold_from: number | null;
    at_or_above_threshold_share: number | null;
  };
  items_per_order: {
    orders: number;
    average_items: number | null;
    single_item_share: number | null;
    bars: { label: string; orders: number; share: number }[];
  };
  not_available: string[];
};

export type SegmentSplit = {
  dimension: "device" | "channel";
  days: number;
  rows: SegmentRow[];
  revenue_available: boolean;
  revenue_note: string;
};

export type DeviceFunnelSteps = { sessions: number; added_to_cart: number; reached_checkout: number; completed_checkout: number };

export type DeviceFunnel = {
  period: "today" | "yesterday" | "last7";
  window_label: string;
  devices: Record<string, DeviceFunnelSteps>;
};

export type BuyHeatmap = {
  days: number;
  window_label: string;
  weekdays: string[];
  cells: { weekday: number; hour: number; sessions: number; orders: number; cvr: number | null }[];
  hours_with_data: number;
  average_cvr: number | null;
  metric?: "cvr" | "orders";
  total_orders?: number;
  note?: string | null;
};

export type KpiRange = "today" | "yesterday" | "last30";

export type KpiTotals = {
  labels: Record<KpiRange, string>;
  sales: Record<KpiRange, number | null> & { source: string | null };
  sessions: Record<KpiRange, number | null> & { source: string | null; error?: string };
};

export type ChangeLogArea = "theme" | "app" | "price" | "promo" | "ad" | "other";

export type ChangeLogEntry = {
  id: number;
  date: string;
  change: string;
  area: ChangeLogArea;
  owner: string | null;
  created_at: string | null;
};

export type ChangeLogResponse = {
  days: number;
  valid_areas: ChangeLogArea[];
  entries: ChangeLogEntry[];
};

// revenue/orders are null for days before our synced order history starts.
export type SalesTrendDay = { date: string; revenue: number | null; orders: number | null };

export type SalesTrend = {
  days: number;
  include_today?: boolean;
  today?: string;
  history_start: string | null;
  current: SalesTrendDay[];
  previous: SalesTrendDay[];
};

export type SalesBreakdownRow = {
  label: string;
  value: number | null;
  baseline_value: number | null;
  baseline_label: string;
  change_abs: number | null;
  change_pct: number | null;
  too_early: boolean;
};

export type SalesBreakdown = {
  period: "yesterday" | "today" | "last7";
  period_label: string;
  compare: "4week_avg" | "last_week";
  too_early: boolean;
  rows: SalesBreakdownRow[];
  note: string;
};

export type OrderHealth = {
  days: number;
  total_orders: number;
  paid: { count: number; pct: number };
  refunded: { count: number; pct: number };
  cancelled: { count: number; pct: number };
  pending: { count: number; pct: number };
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (API_KEY) headers.set("x-api-key", API_KEY);

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export const api = {
  summary: () => request<DashboardSummary>("/dashboard/summary"),
  cvrTrend: (days: number) =>
    request<{ store_id: number; days: CvrDay[] }>(`/dashboard/cvr-trend?days=${days}`),
  alerts: (limit = 100) => request<AlertItem[]>(`/dashboard/alerts?limit=${limit}`),
  sync: () => request<Record<string, unknown>>("/dashboard/sync?days=2", { method: "POST" }),
  sendDailyReport: () =>
    request<{ status: string; detail?: string; report_date?: string; subject?: string }>("/dashboard/send-daily-report", { method: "POST" }),
  topProducts: (days = 1, limit = 5) =>
    request<{ days: number; products: TopProduct[] }>(`/dashboard/top-products?days=${days}&limit=${limit}`),
  topProductsFor: (period: "today" | "yesterday" | "last7", limit = 5) =>
    request<{ days: number; products: TopProduct[] }>(`/dashboard/top-products?period=${period}&limit=${limit}`),
  ordersTrend: (days = 7) =>
    request<{ days: number; trend: OrdersTrendDay[] }>(`/dashboard/orders-trend?days=${days}`),
  funnel: () => request<Funnel>("/dashboard/funnel"),
  funnelCompare: (period: "today" | "yesterday" | "last7" = "yesterday") =>
    request<FunnelCompare>(`/dashboard/funnel-compare?period=${period}`),
  funnelTrend: (days = 7) =>
    request<{ days: number; trend: FunnelTrendDay[] }>(`/dashboard/funnel-trend?days=${days}`),
  alarmRules: () => request<AlarmRuleItem[]>("/dashboard/alarm-rules"),
  updateAlarmRule: (id: number, patch: { is_active?: boolean; threshold?: number }) =>
    request<AlarmRuleItem>(`/dashboard/alarm-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  settings: () => request<SettingsData>("/dashboard/settings"),
  updateSettings: (patch: { notification_email?: string | null; email_alerts_enabled?: boolean }) =>
    request<Partial<SettingsData>>("/dashboard/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  storeInfo: () => request<StoreInfo>("/dashboard/store-info"),
  siteHealth: (range: LandingRange = 28) =>
    request<SiteHealthData>(`/dashboard/site-health?${typeof range === "number" ? `days=${range}` : `period=${range}`}`),
  cartExtras: (range: LandingRange = 28, threshold?: number | null) =>
    request<CartExtras>(
      `/dashboard/cart-extras?${typeof range === "number" ? `days=${range}` : `period=${range}`}${threshold ? `&threshold=${threshold}` : ""}`,
    ),
  landingPages: (range: LandingRange = 28) =>
    request<LandingPagesData>(
      typeof range === "number" ? `/dashboard/landing-pages?days=${range}` : `/dashboard/landing-pages?period=${range}`,
    ),
  productAnalytics: (days = 28) => request<ProductAnalyticsData>(`/dashboard/product-analytics?days=${days}`),
  productPerformance: (days = 30) =>
    request<{ days: number; products: ProductPerformance[] }>(`/dashboard/product-performance?days=${days}`),
  recommendations: () => request<{ recommendations: Recommendation[] }>("/dashboard/recommendations"),
  benchmarks: () => request<Benchmarks>("/dashboard/benchmarks"),
  orderHealth: (days = 30) => request<OrderHealth>(`/dashboard/order-health?days=${days}`),
  overview: (period: "yesterday" | "today" | "last7" = "yesterday", compare: "4week_avg" | "last_week" = "4week_avg") =>
    request<Overview>(`/dashboard/overview?period=${period}&compare=${compare}`),
  salesTrend: (days = 14, includeToday = false) =>
    request<SalesTrend>(`/dashboard/sales-trend?days=${days}${includeToday ? "&include_today=true" : ""}`),
  salesBreakdown: (period: "yesterday" | "today" | "last7" = "yesterday", compare: "4week_avg" | "last_week" = "4week_avg") =>
    request<SalesBreakdown>(`/dashboard/sales-breakdown?period=${period}&compare=${compare}`),
  funnelDevices: (period: "today" | "yesterday" | "last7") =>
    request<DeviceFunnel>(`/dashboard/funnel-devices?period=${period}`),
  kpiTotals: () => request<KpiTotals>("/dashboard/kpi-totals"),
  buyHeatmap: (days = 28) => request<BuyHeatmap>(`/dashboard/buy-heatmap?days=${days}`),
  segments: (dimension: "device" | "channel", days = 7) =>
    request<SegmentSplit>(`/dashboard/segments?dimension=${dimension}&days=${days}`),
  changeLog: (days = 90) => request<ChangeLogResponse>(`/dashboard/change-log?days=${days}`),
  addChangeLogEntry: (entry: { date: string; change: string; area: ChangeLogArea; owner?: string }) =>
    request<ChangeLogEntry>("/dashboard/change-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }),
  deleteChangeLogEntry: (id: number) =>
    request<{ deleted: number }>(`/dashboard/change-log/${id}`, { method: "DELETE" }),
};

export function formatMoney(value: number, currency?: string | null) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toFixed(0)} ${currency || ""}`.trim();
  }
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
