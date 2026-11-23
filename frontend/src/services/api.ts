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
  live_detail?: string | null;
  limit_text?: string | null;
  page?: string | null;
};

export type KpiCalendarDay = {
  date: string;
  revenue: number | null;
  orders: number;
  aov: number | null;
  sessions: number | null;
  cvr: number | null;
  rps: number | null;
};

export type KpiCalendar = {
  first: string;
  last: string;
  timezone: string | null;
  revenue_source: "shopify" | "orders";
  sessions_error: string | null;
  days: KpiCalendarDay[];
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
  refund_rate?: number | null;
};

export type ProductMover = { name: string; category: string; revenue: number; prior_revenue: number; quantity: number; prior_quantity: number; change: number; change_pct: number | null };
export type ProductRefundRow = { name: string; category: string; gross_sales: number; refunded: number; refund_rate: number };

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
  movers?: { up: ProductMover[]; down: ProductMover[] };
  refunds?: {
    store_refund_rate: number | null;
    total_refunded: number;
    min_gross_sales: number;
    by_rate: ProductRefundRow[];
    by_amount: ProductRefundRow[];
  } | null;
};

export type FunnelTrendDay = Funnel & {
  cart_abandonment_rate: number | null;
  checkout_abandonment_rate: number | null;
};

export type RecAction = "fix" | "promote" | "test";
export type RecStatus = "open" | "in_progress" | "done" | "ignored";
export type RecRange = "yesterday" | 7 | 30;

export type RecMetric = {
  label: string;
  value: string;
  compare: string | null;
  compare_label: string | null;
  gap: string | null;
  bad: boolean | null;
};

export type RecTest = {
  hypothesis: string;
  metric: string;
  metric_key: ExperimentMetric;
  target_lift_pct: number;
  sessions_per_variant: number | null;
  days_needed: number | null;
  note: string | null;
};

export type Recommendation = {
  key: string;
  rank: number;
  kind: string;
  area: string;
  action: RecAction;
  title: string;
  page: string;
  page_path: string | null;
  segment: string;
  diagnosis: string;
  metrics: RecMetric[];
  causes: string[];
  steps: string[];
  test: RecTest | null;
  evidence: string[];
  impact: number | null;
  monthly_impact: number | null;
  impact_formula: string;
  assumption: string | null;
  window_days: number;
  window_label: string;
  confidence: "High" | "Medium" | "Low";
  effort: "Low" | "Medium" | "High";
  priority_score: number;
  status: RecStatus;
  status_updated_at: string | null;
};

export type RecFunnelStep = {
  key: string;
  label: string;
  value: number;
  pct_of_sessions: number | null;
  previous_pct_of_sessions: number | null;
};

export type RecFunnel = {
  steps: RecFunnelStep[];
  step_rates: Record<string, number | null>;
  previous_step_rates: Record<string, number | null>;
  weakest_step: string | null;
};

export type OverviewTrends = {
  days: number;
  window_label: string;
  previous_label: string;
  current: { date: string; aov: number | null; orders: number; sessions: number | null }[];
  previous: { date: string; aov: number | null; orders: number; sessions: number | null }[];
  aov: { current: number | null; previous: number | null };
  sessions: { current: number | null; previous: number | null };
  channels: { channel: string; total_sales: number; orders: number; share: number | null }[];
  channels_total: number;
  errors: Record<string, string>;
};

export type DiscountStats = {
  orders: number;
  net_sales: number;
  aov: number | null;
  discount_given: number;
  avg_discount: number | null;
  discount_pct: number | null;
  share_of_orders: number | null;
};

export type DeeperData = {
  days: number;
  window_label: string;
  errors: Record<string, string>;
  price_bands: {
    rows: { band: string; from: number; products: number; orders: number; items: number; net_sales: number; share_of_sales: number | null; views: number | null; conversion_rate: number | null }[];
    conversion_available: boolean;
    views_window_label: string | null;
    sales_source: string | null;
  } | null;
  discounts: {
    total_orders: number;
    with_code: DiscountStats;
    without_code: DiscountStats;
    codes: (DiscountStats & { code: string })[];
    code_count: number;
  } | null;
  bought_together: {
    rows: { a: string; b: string; orders_together: number; a_orders: number; b_orders: number; pct_of_a: number | null; pct_of_b: number | null; lift: number | null }[];
    orders: number;
    multi_product_orders: number;
    multi_share: number | null;
  } | null;
  new_vs_returning: {
    orders_with_journey: number;
    orders_total: number;
    new: { orders: number; share_of_orders: number; net_sales: number; aov: number | null };
    returning: { orders: number; share_of_orders: number; net_sales: number; aov: number | null };
    first_order: {
      median_visits: number | null;
      median_days: number | null;
      visits: { label: string; orders: number; share: number }[];
      days: { label: string; orders: number; share: number }[];
      with_visits: number;
      with_days: number;
    };
  } | null;
  repeat_purchase: {
    first_time_buyers: number;
    came_back: number;
    repeat_rate: number;
    min_buyers: number;
    rows: { product: string; first_time_buyers: number; came_back: number; repeat_rate: number }[];
  } | null;
  customer_data?: { journey: boolean; customers: boolean };
};

export type ExperimentMetric = "conversion_rate" | "added_to_cart_rate" | "bounce_rate" | "aov";

export type ExperimentResult = {
  state: "planned" | "running" | "finished" | "error";
  verdict: "not_started" | "win" | "loss" | "running" | "no_clear_result" | "too_few" | "better" | "worse" | "flat" | "early" | "no_data" | "error";
  summary?: string;
  error?: string;
  days_measured?: number;
  before_label?: string;
  during_label?: string;
  before?: number | null;
  during?: number | null;
  before_n?: number;
  during_n?: number;
  n_unit?: "sessions" | "orders";
  change?: number;
  change_unit?: "pts" | "%";
  confidence?: number | null;
};

export type Experiment = {
  id: number;
  name: string;
  hypothesis: string;
  metric: ExperimentMetric;
  metric_label: string;
  better: "up" | "down";
  page_path: string | null;
  start_date: string;
  end_date: string | null;
  owner: string | null;
  rec_key: string | null;
  created_at: string | null;
  result: ExperimentResult;
};

export type ExperimentInput = {
  name: string;
  hypothesis: string;
  metric: ExperimentMetric;
  start_date: string;
  end_date: string | null;
  page_path: string | null;
  owner: string | null;
  rec_key: string | null;
};

export type Recommendations = {
  days: number;
  period: string;
  window_label: string;
  compare_label: string;
  store_conversion_rate: number | null;
  industry_conversion_rate: number;
  sessions: number;
  aov: number | null;
  orders: number;
  total_impact: number;
  top5_monthly_impact: number;
  total_monthly_impact: number;
  top_keys: string[];
  funnel: RecFunnel | null;
  coverage: { source: string; ok: boolean }[];
  areas: string[];
  recommendations: Recommendation[];
  errors: string[];
  generated_at: string;
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

export type SpeedRating = "good" | "needs_improvement" | "poor" | null;
export type MobileSpeed = {
  day: string;
  day_label: string;
  lcp_ms: number | null; lcp_rating: SpeedRating;
  inp_ms: number | null; inp_rating: SpeedRating;
  cls: number | null; cls_rating: SpeedRating;
  rating: "good" | "needs_improvement" | "poor";
  page_loads: number;
};

export type Overview = {
  period: "yesterday" | "today" | "last7" | "date";
  date?: string;
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
    sessions?: OverviewMetric;
    revenue_per_session?: OverviewMetric;
  };
  health: {
    last_order_at: string | null;
    last_synced_at?: string | null;
    mobile_page_speed: MobileSpeed | null;
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

export type LandingWindowName = "week" | "prev_week" | "month" | "prev_month";

export type LandingWindowMetrics = {
  sessions: number;
  bounce_rate: number | null;
  added_to_cart_rate: number | null;
  conversion_rate: number | null;
  orders?: number | null;
  revenue?: number | null;
  revenue_per_session?: number | null;
  aov?: number | null;
};

export type LandingWindowsMeta = Record<LandingWindowName, { first: string; last: string; label: string }>;

export type LandingCompareRow = Record<LandingWindowName, LandingWindowMetrics> & {
  path: string;
  page_type: string;
  week_enough: boolean;
  month_enough: boolean;
};

export type LandingCompareData = {
  windows: LandingWindowsMeta;
  wow_label: string;
  mom_label: string;
  min_week: number;
  min_month: number;
  revenue_available: boolean;
  pages: LandingCompareRow[];
  errors: Record<string, string>;
};

export type LandingDeepSplit = Partial<Record<LandingWindowName, LandingWindowMetrics>> & { label: string };

export type LandingDeepDive = {
  path: string;
  page_type: string;
  windows: LandingWindowsMeta;
  min_week: number;
  min_month: number;
  revenue_available: boolean;
  metrics: Record<LandingWindowName, LandingWindowMetrics>;
  daily: ({ date: string } & LandingWindowMetrics)[];
  sources: LandingDeepSplit[];
  devices: LandingDeepSplit[];
  countries: LandingDeepSplit[];
  clarity: ({ available: boolean; handle: string } & Partial<Record<LandingWindowName, number>>) | null;
  insights: { tone: "good" | "bad" | "info"; text: string }[];
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
  comparison: CartCompareData | null;
  not_available: string[];
};

export type CartCompare = "previous" | "last_week" | "4week_avg" | "4weeks_ago" | "last_year";

export type CartCompareData = {
  mode: CartCompare;
  error?: string;
  label?: string;
  payment_counts_comparable?: boolean;
  payments?: {
    methods: PaymentRow[];
    wallets: PaymentRow[];
    attempts: number;
    successful: number;
    failed_attempts: number;
    authorization_rate: number | null;
  } | null;
  payments_error?: string | null;
  orders_note?: string | null;
  order_values?: {
    orders: number;
    average: number | null;
    median: number | null;
    near_threshold_share: number | null;
    at_or_above_threshold_share: number | null;
  };
  items_per_order?: { average_items: number | null; single_item_share: number | null };
};

export type WhereRow = {
  key: string;
  label: string;
  sessions: number;
  previous_sessions: number;
  sessions_change_pct: number | null;
  conversion_rate: number | null;
  previous_conversion_rate: number | null;
  conversion_change_pts: number | null;
  purchases: number;
  previous_purchases: number;
  purchases_change: number;
  traffic_effect: number | null;
  conversion_effect: number | null;
  enough_data: boolean;
  revenue_per_session?: number | null;
  previous_revenue_per_session?: number | null;
  revenue_per_session_change_pct?: number | null;
};

export type WhereMover = { dimension: "device" | "channel"; segment: string; kind: "traffic" | "conversion"; effect: number; good: boolean; text: string };

export type WhereChanged = {
  period: "yesterday" | "days";
  days: number;
  window_label: string;
  compare_label: string;
  too_early: boolean;
  total_sessions: number;
  min_segment_sessions: number;
  device: WhereRow[];
  channel: WhereRow[];
  movers: WhereMover[];
  errors: Record<string, string>;
};

export type GeoRow = {
  label: string;
  sessions: number;
  previous_sessions: number | null;
  sessions_change_pct: number | null;
  added_to_cart_rate: number | null;
  conversion_rate: number | null;
  previous_conversion_rate: number | null;
  conversion_change_pts: number | null;
  purchases: number;
  share_of_sessions: number | null;
  enough_data: boolean;
};

export type GeoSplit = {
  period: "yesterday" | "days";
  days: number;
  window_label: string;
  compare_label: string;
  min_segment_sessions: number;
  countries: GeoRow[] | null;
  states: GeoRow[] | null;
  errors: Record<string, string>;
};

export type GridCell = { sessions: number; bounce_rate: number | null; added_to_cart_rate: number | null; conversion_rate: number | null; enough_data: boolean };
export type Grid = { rows: string[]; columns: string[]; cells: GridCell[][]; row_totals: GridCell[]; column_totals: GridCell[] };
export type LandingGrids = {
  days: number;
  period: string;
  window_label: string;
  min_sessions: number;
  page_source: Grid | null;
  type_device: Grid | null;
  errors: Record<string, string>;
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
  compare_labels?: Record<KpiRange, string | null>;
  sales: Record<KpiRange, number | null> & { source: string | null; previous?: Record<KpiRange, number | null> };
  sessions: Record<KpiRange, number | null> & { source: string | null; error?: string; previous?: Record<KpiRange, number | null> };
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

export type OrderHealthRange = "today" | "yesterday" | 7 | 30;

export type OrderHealth = {
  days: number;
  period: string;
  window_label: string;
  source: "shopify" | "synced_orders";
  note: string | null;
  total_orders: number;
  paid: { count: number; pct: number };
  partially_refunded: { count: number; pct: number };
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
  cartExtras: (range: LandingRange = 28, threshold?: number | null, compare?: CartCompare | null) =>
    request<CartExtras>(
      `/dashboard/cart-extras?${typeof range === "number" ? `days=${range}` : `period=${range}`}${threshold ? `&threshold=${threshold}` : ""}${compare ? `&compare=${compare}` : ""}`,
    ),
  landingGrids: (range: LandingRange = 28) =>
    request<LandingGrids>(
      typeof range === "number" ? `/dashboard/landing-grids?days=${range}` : `/dashboard/landing-grids?period=${range}`,
    ),
  landingPages: (range: LandingRange = 28) =>
    request<LandingPagesData>(
      typeof range === "number" ? `/dashboard/landing-pages?days=${range}` : `/dashboard/landing-pages?period=${range}`,
    ),
  landingCompare: () => request<LandingCompareData>("/dashboard/landing-compare"),
  landingDeepDive: (path: string) =>
    request<LandingDeepDive>(`/dashboard/landing-deep-dive?path=${encodeURIComponent(path)}`),
  productAnalytics: (days = 28) => request<ProductAnalyticsData>(`/dashboard/product-analytics?days=${days}`),
  productPerformance: (days = 30) =>
    request<{ days: number; products: ProductPerformance[] }>(`/dashboard/product-performance?days=${days}`),
  recommendations: (range: RecRange = 30) =>
    request<Recommendations>(`/dashboard/recommendations?${range === "yesterday" ? "period=yesterday" : `days=${range}`}`),
  geo: (range: "yesterday" | 7 | 28) =>
    request<GeoSplit>(range === "yesterday" ? "/dashboard/geo?period=yesterday" : `/dashboard/geo?period=days&days=${range}`),
  whereChanged: (range: "yesterday" | 7 | 28) =>
    request<WhereChanged>(range === "yesterday" ? "/dashboard/where-changed?period=yesterday" : `/dashboard/where-changed?period=days&days=${range}`),
  overviewTrends: (days: 7 | 14 | 30) => request<OverviewTrends>(`/dashboard/overview-trends?days=${days}`),
  deeper: (days: 7 | 30 | 60) => request<DeeperData>(`/dashboard/deeper?days=${days}`),
  experiments: () =>
    request<{ metrics: { key: ExperimentMetric; label: string; unit: string; better: "up" | "down" }[]; experiments: Experiment[] }>(
      "/dashboard/experiments",
    ),
  saveExperiment: (body: ExperimentInput, id?: number) =>
    request<Experiment>(id ? `/dashboard/experiments/${id}` : "/dashboard/experiments", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteExperiment: (id: number) => request<{ deleted: number }>(`/dashboard/experiments/${id}`, { method: "DELETE" }),
  setRecommendationStatus: (key: string, status: RecStatus) =>
    request<{ key: string; status: RecStatus }>("/dashboard/recommendations/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, status }),
    }),
  benchmarks: () => request<Benchmarks>("/dashboard/benchmarks"),
  orderHealth: (range: OrderHealthRange = 30) =>
    request<OrderHealth>(`/dashboard/order-health?${typeof range === "number" ? `days=${range}` : `period=${range}`}`),
  // period "date" = one day picked on the calendar (YYYY-MM-DD in `date`).
  overview: (period: "yesterday" | "today" | "last7" | "date" = "yesterday", compare: "4week_avg" | "last_week" = "4week_avg", date?: string) =>
    request<Overview>(`/dashboard/overview?period=${period === "date" ? "yesterday" : period}&compare=${compare}${period === "date" && date ? `&date=${date}` : ""}`),
  kpiCalendar: (days = 35) => request<KpiCalendar>(`/dashboard/kpi-calendar?days=${days}`),
  salesTrend: (days = 14, includeToday = false) =>
    request<SalesTrend>(`/dashboard/sales-trend?days=${days}${includeToday ? "&include_today=true" : ""}`),
  salesBreakdown: (period: "yesterday" | "today" | "last7" | "date" = "yesterday", compare: "4week_avg" | "last_week" = "4week_avg", date?: string) =>
    request<SalesBreakdown>(`/dashboard/sales-breakdown?period=${period === "date" ? "yesterday" : period}&compare=${compare}${period === "date" && date ? `&date=${date}` : ""}`),
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

export function formatMoney(value: number, currency?: string | null, digits = 0) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency || ""}`.trim();
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
