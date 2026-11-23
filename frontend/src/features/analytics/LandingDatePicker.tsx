import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { PickedDates } from "../../services/api";

// Calendar for the Landing Pages page: pick any past date range.
// - All landing pages / Page type / Grids tabs: show exactly these dates,
//   compared with the same number of days right before.
// - Week / Month compare, Date-wise and the deep dive: the "To" date becomes
//   their last day (so you can see WoW / MoM as it was on that date).

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const pretty = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

function presets(): { label: string; value: PickedDates }[] {
  const today = new Date();
  const y = addDays(today, -1);
  const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastPrev = addDays(firstThis, -1);
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  return [
    { label: "Last 14 days", value: { start: iso(addDays(y, -13)), end: iso(y) } },
    { label: "Last 30 days", value: { start: iso(addDays(y, -29)), end: iso(y) } },
    { label: "Last 90 days", value: { start: iso(addDays(y, -89)), end: iso(y) } },
    { label: "This month", value: { start: iso(firstThis), end: iso(today.getDate() > 1 ? y : today) } },
    { label: "Last month", value: { start: iso(firstPrev), end: iso(lastPrev) } },
  ];
}

function LandingDatePicker({ value, onChange }: { value: PickedDates | null; onChange: (v: PickedDates | null) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(value?.start ?? "");
  const [end, setEnd] = useState(value?.end ?? "");
  const box = useRef<HTMLDivElement>(null);
  const today = iso(new Date());

  useEffect(() => {
    if (!open) return;
    setStart(value?.start ?? iso(addDays(new Date(), -30)));
    setEnd(value?.end ?? iso(addDays(new Date(), -1)));
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, value]);

  const bad = !start || !end ? "Pick both dates." : start > end ? "'From' is after 'To'." : end > today ? "'To' can't be in the future." : null;
  const apply = (v: PickedDates) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative shrink-0">
      <div className="flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${value ? "bg-blue-600 text-white" : "border text-slate-600 hover:bg-slate-50"}`}
        >
          <CalendarDays size={15} />
          {value ? `${pretty(value.start)} - ${pretty(value.end)}` : "Pick dates"}
        </button>
        {value && (
          <button onClick={() => onChange(null)} className="ml-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear dates" title="Back to the normal buttons">
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-2xl border bg-white p-4 text-sm shadow-xl">
          <p className="mb-2 text-xs font-semibold text-slate-500">Quick picks</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {presets().map((p) => (
              <button key={p.label} onClick={() => apply(p.value)} className="rounded-full border px-2.5 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-700">
                {p.label}
              </button>
            ))}
          </div>
          <p className="mb-2 text-xs font-semibold text-slate-500">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">
              From
              <input type="date" value={start} max={end || today} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm text-slate-800" />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input type="date" value={end} min={start || undefined} max={today} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm text-slate-800" />
            </label>
          </div>
          {bad && start && end && <p className="mt-2 text-xs text-red-600">{bad}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-slate-500 hover:bg-slate-50">Cancel</button>
            <button disabled={!!bad} onClick={() => apply({ start, end })} className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white disabled:opacity-40">Apply</button>
          </div>
          <p className="mt-3 text-[11px] leading-snug text-slate-400">
            Tabs 1, 5 and 6 show exactly these dates (vs the same number of days before). Week / Month compare, Funnel, Date-wise and the deep dive end on the "To" date.
          </p>
        </div>
      )}
    </div>
  );
}

export default LandingDatePicker;
