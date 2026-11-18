import { useEffect, useState } from "react";
import { Lightbulb, AlertCircle, ArrowRight } from "lucide-react";
import { api, type Recommendation } from "../../services/api";

const priorityStyle: Record<string, string> = {
  High: "bg-red-50 text-red-700 border-red-200",
  Medium: "bg-amber-50 text-amber-700 border-amber-200",
  Low: "bg-slate-100 text-slate-600 border-slate-200",
};

function CroRecommendations() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .recommendations()
      .then((r) => setRecs(r.recommendations))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load recommendations"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Optimization / Insights</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">CRO Recommendations</h1>
        <p className="mt-2 text-sm text-slate-500">
          Rule-based suggestions generated from your store's real data - each one backed by evidence below it.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading && <p className="text-sm text-slate-400">Analyzing store data…</p>}

      {!loading && !error && recs.length === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          <AlertCircle size={20} className="text-emerald-500" />
          No issues detected right now - your store's key metrics look healthy.
        </div>
      )}

      <div className="space-y-4">
        {recs.map((rec, i) => (
          <div key={i} className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="flex gap-4">
                <div className="h-fit rounded-xl bg-amber-50 p-3 text-amber-600">
                  <Lightbulb size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{rec.title}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{rec.explanation}</p>
                </div>
              </div>
              <span className={`w-fit shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${priorityStyle[rec.priority]}`}>
                {rec.priority} priority
              </span>
            </div>

            <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Evidence</p>
                <p className="mt-1 text-sm text-slate-600">{rec.evidence}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Affected metric</p>
                <p className="mt-1 text-sm text-slate-600">{rec.affected_metric}</p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <ArrowRight size={16} className="mt-0.5 shrink-0" />
              <span>{rec.suggested_action}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CroRecommendations;
