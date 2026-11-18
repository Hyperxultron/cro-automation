import { useEffect, useState } from "react";
import { Store, Mail, Clock, ShieldCheck, Save, Bell, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, type SettingsData } from "../../services/api";

function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [email, setEmail] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setData(s);
        setEmail(s.notification_email ?? "");
        setAlertsEnabled(s.email_alerts_enabled);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await api.updateSettings({
        notification_email: email.trim() || null,
        email_alerts_enabled: alertsEnabled,
      });
      setData((prev) => (prev ? { ...prev, ...updated } : prev));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Workspace / Configuration</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage your store, notification preferences and workspace settings.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
            <Store size={21} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Store Configuration</h2>
            <p className="text-xs text-slate-500">Your e-commerce store details</p>
          </div>
        </div>

        <label className="mb-2 block text-sm font-medium text-slate-700">Store Name</label>
        <input
          value={loading ? "Loading…" : (data?.store_name ?? "—")}
          readOnly
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">Synced from Shopify - edit this in Shopify Admin.</p>

        <div
          className={`mt-4 flex items-center gap-2 rounded-xl p-4 text-sm ${
            data ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
          }`}
        >
          {data ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {loading
            ? "Checking connection…"
            : data
              ? `Connected to ${data.store_domain}`
              : "Shopify connection is not configured yet."}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-violet-50 p-3 text-violet-600">
            <Mail size={21} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Email Notifications</h2>
            <p className="text-xs text-slate-500">Configure alert delivery preferences</p>
          </div>
        </div>

        <label className="mb-2 block text-sm font-medium text-slate-700">Notification Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
          placeholder="Enter your email address"
        />

        <label className="mt-5 flex cursor-pointer items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bell className="text-slate-500" size={20} />
            <div>
              <p className="text-sm font-medium text-slate-800">Email alerts</p>
              <p className="text-xs text-slate-500">Send an email when an alarm triggers</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={alertsEnabled}
            onChange={(e) => setAlertsEnabled(e.target.checked)}
            className="h-5 w-5 accent-blue-600"
          />
        </label>

        {!loading && !data?.smtp_configured && (
          <p className="mt-4 text-xs text-amber-700">
            Email sending isn't configured on the server yet (SMTP settings missing) - your preference will be
            saved, but emails won't actually go out until that's set up.
          </p>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
            <Clock size={21} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Regional Settings</h2>
            <p className="text-xs text-slate-500">Timezone used for monitoring and reports</p>
          </div>
        </div>

        <label className="mb-2 block text-sm font-medium text-slate-700">Timezone</label>
        <input
          value={loading ? "Loading…" : (data?.timezone ?? "—")}
          readOnly
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">Detected automatically from your Shopify store.</p>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck className={data ? "text-emerald-600" : "text-amber-600"} size={22} />
          <div>
            <h2 className="font-bold text-slate-900">System Status</h2>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Checking…" : data ? "Live data · backend connected" : "Backend connection pending"}
            </p>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm font-medium text-emerald-600">Saved!</span>}
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          <Save size={17} />
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

export default Settings;
