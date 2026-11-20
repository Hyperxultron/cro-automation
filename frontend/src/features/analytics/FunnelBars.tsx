import type { FunnelCompare } from "../../services/api";

// Horizontal funnel bars (checklist: "bars for funnels"). Each step shows its
// count, share of sessions, step-to-step %, and the comparison window's
// step-to-step % alongside.
function FunnelBars({ data, loading, compact = false }: { data: FunnelCompare | null; loading: boolean; compact?: boolean }) {
    if (!data) {
        return <p className="text-xs text-slate-400">{loading ? "Loading…" : "No session data available."}</p>;
    }
    const steps = data.steps.filter((s) => s.available);
    const maxValue = steps[0]?.value || 1;

    return (
        <div className="space-y-3">
            {steps.map((step, i) => {
                const width = step.value != null ? Math.max((step.value / maxValue) * 100, 1.5) : 0;
                const prevWidth = step.previous_value != null ? Math.max((step.previous_value / (steps[0]?.previous_value || 1)) * 100, 1.5) : 0;
                const change = step.step_change_pts;
                return (
                    <div key={step.key}>
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                            <span className="font-medium text-slate-700">{step.label}</span>
                            <span className="text-slate-500">
                                <span className="font-semibold text-slate-900">{step.value?.toLocaleString() ?? "—"}</span>
                                {i > 0 && step.step_pct != null && <> · {step.step_pct}% of previous step</>}
                                {i > 0 && !data.too_early && change != null && (
                                    <span className={`ml-2 font-semibold ${change === 0 ? "text-slate-400" : change > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                        {change > 0 ? "+" : ""}{change} pts
                                    </span>
                                )}
                            </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${width}%` }} />
                        </div>
                        {!compact && step.previous_value != null && (
                            <div className="mt-1 flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded-full bg-slate-50">
                                    <div className="h-full rounded-full bg-slate-300" style={{ width: `${prevWidth}%` }} />
                                </div>
                                <span className="w-40 shrink-0 text-right text-[11px] text-slate-400">
                                    {step.previous_value.toLocaleString()}{i > 0 && step.previous_step_pct != null ? ` · ${step.previous_step_pct}%` : ""}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
            <p className="cro-note pt-1 text-[11px] text-slate-400">
                {data.too_early
                    ? "Too early to compare - fewer than ~500 sessions in this period."
                    : `Step changes are ${data.compare_label}${compact ? "" : "; grey bars show that period"}.`}
                {!data.product_views_available && " Product-view step isn't available from Shopify for this store yet."}
            </p>
        </div>
    );
}

export default FunnelBars;
