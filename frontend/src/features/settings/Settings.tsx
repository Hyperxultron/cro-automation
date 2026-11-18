
import { useState } from "react";
import {
  Store,
  Mail,
  Clock,
  ShieldCheck,
  Save,
  Bell,
} from "lucide-react";

function Settings() {
  const [storeName, setStoreName] = useState("My Shopify Store");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [notifications, setNotifications] = useState(true);

  const handleSave = () => {
    alert("Settings saved in this demo session.");
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

        <label className="mb-2 block text-sm font-medium text-slate-700">
          Store Name
        </label>
        <input
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
          placeholder="Enter store name"
        />

        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Shopify connection is not configured yet. Live store data is not being fetched.
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

        <label className="mb-2 block text-sm font-medium text-slate-700">
          Notification Email
        </label>
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
              <p className="text-xs text-slate-500">Enable notification preference</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="h-5 w-5 accent-blue-600"
          />
        </label>

        <p className="mt-4 text-xs text-amber-700">
          Email delivery requires backend and email provider configuration.
        </p>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
            <Clock size={21} />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Regional Settings</h2>
            <p className="text-xs text-slate-500">Timezone for monitoring and reports</p>
          </div>
        </div>

        <label className="mb-2 block text-sm font-medium text-slate-700">
          Timezone
        </label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
        >
          <option value="Asia/Kolkata">India Standard Time (IST)</option>
          <option value="UTC">UTC</option>
          <option value="America/New_York">Eastern Time</option>
        </select>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-emerald-600" size={22} />
          <div>
            <h2 className="font-bold text-slate-900">System Status</h2>
            <p className="mt-1 text-sm text-slate-500">
              Frontend demo mode · Backend connection pending
            </p>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Save size={17} />
          Save Settings
        </button>
      </div>
    </div>
  );
}

export default Settings;
