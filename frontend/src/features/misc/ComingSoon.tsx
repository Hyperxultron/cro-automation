import type { LucideIcon } from "lucide-react";

function ComingSoon({
  icon: Icon,
  title,
  description,
  roadmap,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  roadmap: string[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center shadow-sm">
        <div className="mb-4 rounded-2xl bg-blue-50 p-4 text-blue-600">
          <Icon size={32} />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Coming soon</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          This module is on the roadmap and isn't built yet - shown here honestly rather than faked.
        </p>
        <div className="mt-6 space-y-2 text-left">
          {roadmap.map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ComingSoon;
