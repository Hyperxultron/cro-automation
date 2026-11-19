import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, Tag, Trash2, User } from "lucide-react";
import { api, type ChangeLogArea, type ChangeLogEntry } from "../../services/api";

// "Change log: date, change, area (theme, app, price, promo, ad), owner"
// (checklist section 8, P1). This is a manually-kept log - Shopify doesn't
// expose a generic "something changed" feed we can sync automatically, so
// the team records what they changed here, and the Overview trend chart
// reads this same list to draw markers on the dates something changed.

const AREA_LABELS: Record<ChangeLogArea, string> = {
  theme: "Theme",
  app: "App",
  price: "Price",
  promo: "Promo",
  ad: "Ad",
  other: "Other",
};

const AREA_COLORS: Record<ChangeLogArea, string> = {
  theme: "bg-violet-50 text-violet-700",
  app: "bg-blue-50 text-blue-700",
  price: "bg-amber-50 text-amber-700",
  promo: "bg-pink-50 text-pink-700",
  ad: "bg-emerald-50 text-emerald-700",
  other: "bg-slate-100 text-slate-600",
};

function todayLocalISO() {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function ChangeLog() {
  const [entries, setEntries] = useState<ChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [date, setDate] = useState(todayLocalISO());
  const [change, setChange] = useState("");
  const [area, setArea] = useState<ChangeLogArea>("other");
  const [owner, setOwner] = useState("");

  const load = () => {
    setError(null);
    api
      .changeLog(90)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load change log"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!change.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.addChangeLogEntry({ date, change: change.trim(), area, owner: owner.trim() || undefined });
      setChange("");
      setOwner("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id)); // optimistic
    try {
      await api.deleteChangeLogEntry(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the entry");
      load(); // roll back on failure
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Optimization / Change Log</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Change Log</h1>
        <p className="mt-2 text-sm text-slate-500">
          Record what you changed (theme, app, price, promo, ad) so a jump or dip in the trend charts has a
          reason next to it, not just a mystery line.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h3 className="mb-4 font-bold text-slate-900">Log a change</h3>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[150px_1fr_140px_160px_auto]">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
            required
          />
          <input
            type="text"
            value={change}
            onChange={(e) => setChange(e.target.value)}
            placeholder="What changed? e.g. Raised quilt prices 10%"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
            required
          />
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as ChangeLogArea)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
          >
            {(Object.keys(AREA_LABELS) as ChangeLogArea[]).map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Owner (optional)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
          <button
            type="submit"
            disabled={submitting || !change.trim()}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Add
          </button>
        </form>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-bold text-slate-900">Recent changes</h3>
          <p className="text-xs text-slate-400">Last 90 days</p>
        </div>
        {loading ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-slate-400">
            No changes logged yet. Add the first one above - it'll show up as a marker on the Overview trend chart.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-4 py-4">
                <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-slate-400">
                  <CalendarClock size={14} />
                  {new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{entry.change}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${AREA_COLORS[entry.area]}`}>
                      <Tag size={10} /> {AREA_LABELS[entry.area]}
                    </span>
                    {entry.owner && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <User size={10} /> {entry.owner}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="shrink-0 rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                  aria-label="Delete entry"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default ChangeLog;
