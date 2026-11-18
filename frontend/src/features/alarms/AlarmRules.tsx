
import { Bell, Clock3, TrendingDown, ShoppingBag, Mail, ShieldCheck } from "lucide-react";

const rules = [
  {
    id: "01",
    title: "Quilt Orders Monitoring",
    description: "Monitor quilt products and trigger an alert when no qualifying order is received for 12 hours.",
    condition: "No quilt orders for 12 hours",
    icon: ShoppingBag,
    frequency: "Continuous monitoring",
  },
  {
    id: "02",
    title: "Conversion Rate Alert",
    description: "Compare yesterday's conversion rate with the previous day and alert when it drops by 20% or more.",
    condition: "CVR decline ≥ 20%",
    icon: TrendingDown,
    frequency: "Daily comparison",
  },
];

function AlarmRules() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Automation / Monitoring</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Alarm Rules</h1>
        <p className="mt-2 text-sm text-slate-500">
          Configure and review your store monitoring conditions.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
              <Bell size={21} />
            </div>
            <div>
              <p className="text-sm text-slate-500">Configured Rules</p>
              <h2 className="text-2xl font-bold">02</h2>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
              <ShieldCheck size={21} />
            </div>
            <div>
              <p className="text-sm text-slate-500">Monitoring Mode</p>
              <h2 className="text-2xl font-bold">Demo</h2>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {rules.map((rule) => {
          const Icon = rule.icon;

          return (
            <div key={rule.id} className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="flex gap-4">
                  <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                    <Icon size={23} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-blue-600">RULE #{rule.id}</p>
                    <h3 className="mt-1 text-lg font-bold text-slate-900">{rule.title}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      {rule.description}
                    </p>
                  </div>
                </div>

                <span className="w-fit rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                  Demo configuration
                </span>
              </div>

              <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Clock3 size={17} className="text-slate-400" />
                  {rule.condition}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Mail size={17} className="text-slate-400" />
                  {rule.frequency}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AlarmRules;
