import type { LandingRange } from "../services/api";

// Today (live) / Yesterday / Last 7 / Last 28 days - the same buttons on every
// analytics page, so "which dates am I looking at?" is never a guess.
export const RANGES: { key: LandingRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: 7, label: "Last 7 days" },
  { key: 28, label: "Last 28 days" },
];

export function rangeQuery(range: LandingRange): string {
  return typeof range === "number" ? `days=${range}` : `period=${range}`;
}

export function rangeLabel(range: LandingRange): string {
  return RANGES.find((r) => r.key === range)?.label ?? "";
}

function RangePicker({ value, onChange }: { value: LandingRange; onChange: (r: LandingRange) => void }) {
  return (
    <div className="flex flex-wrap rounded-xl border bg-white p-1 text-sm">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => r.key !== value && onChange(r.key)}
          className={`rounded-lg px-3 py-1.5 font-medium ${value === r.key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export default RangePicker;
