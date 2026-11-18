// Backend API calls (real Shopify data)

const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const API_KEY = import.meta.env.VITE_DASHBOARD_API_KEY as string | undefined;

export type OrderStats = { orders: number; revenue: number; quilt_orders: number };

export type QuiltAlarm = {
  status: string;
  store_id?: number;
  last_quilt_order_number?: string;
  last_quilt_order_at?: string;
  hours_elapsed?: number;
  threshold_hours?: number;
  alert_id?: number;
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
