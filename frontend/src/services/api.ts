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
  topProducts: (days = 1, limit = 5) =>
    request<{ days: number; products: TopProduct[] }>(`/dashboard/top-products?days=${days}&limit=${limit}`),
  ordersTrend: (days = 7) =>
    request<{ days: number; trend: OrdersTrendDay[] }>(`/dashboard/orders-trend?days=${days}`),
  funnel: () => request<Funnel>("/dashboard/funnel"),
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
  productPerformance: (days = 30) =>
    request<{ days: number; products: ProductPerformance[] }>(`/dashboard/product-performance?days=${days}`),
  recommendations: () => request<{ recommendations: Recommendation[] }>("/dashboard/recommendations"),
  benchmarks: () => request<Benchmarks>("/dashboard/benchmarks"),
  orderHealth: (days = 30) => request<OrderHealth>(`/dashboard/order-health?days=${days}`),
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
