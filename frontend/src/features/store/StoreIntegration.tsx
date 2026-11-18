import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Globe, Key, RefreshCw, Store, Clock3 } from "lucide-react";
import { api, timeAgo, type StoreInfo } from "../../services/api";

function StoreIntegration() {
  const [info, setInfo] = useState<StoreInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .storeInfo()
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load store info"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reconnect = async () => {
    setSyncing(true);
    try {
      await api.sync();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Management / Integration</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Store Integration</h1>
        <p className="mt-2 text-sm text-slate-500">Your connected Shopify store and sync status.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
              <Store size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{loading ? "Loading…" : (info?.name ?? "—")}</h2>
              <p className="flex items-center gap-1.5 text-sm text-slate-500">
                <Globe size={14} /> {info?.domain ?? "—"}
              </p>
            </div>
          </div>
          <span className="flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={14} /> Connected
          </span>
        </div>

        <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-400">Connected since</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {info?.connected_at ? new Date(info.connected_at).toLocaleDateString() : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Timezone</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{info?.timezone ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Currency</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{info?.currency ?? "—"}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
            <Key size={21} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Authentication</h2>
            <p className="text-xs text-slate-500">How this app talks to Shopify</p>
          </div>
        </div>
        <p className="text-sm text-slate-600">{info?.auth_method ?? "—"}</p>
        <p className="mt-2 text-xs text-slate-400">
          Access tokens are never stored in the browser or shown in this dashboard.
        </p>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-50 p-3 text-amber-600">
              <Clock3 size={21} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Sync Status</h2>
              <p className="text-xs text-slate-500">
                Last synced {info?.last_synced_at ? timeAgo(info.last_synced_at) : "never"} · auto-syncs every 15 min
              </p>
            </div>
          </div>
          <button
            onClick={reconnect}
            disabled={syncing}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default StoreIntegration;
