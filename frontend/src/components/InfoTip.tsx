import { useState } from "react";
import { Info } from "lucide-react";

// Small "i" next to a title. Hover or tap to see a plain-language explanation
// of the number: what it means, where it comes from, how to read it.
function InfoTip({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    return (
        <span className="relative inline-flex align-middle">
            <button
                type="button"
                aria-label="What does this mean?"
                onClick={() => setOpen((o) => !o)}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                className="ml-1 text-slate-300 hover:text-slate-500"
            >
                <Info size={13} />
            </button>
            {open && (
                <span className="absolute left-1/2 top-5 z-30 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg">
                    {text}
                </span>
            )}
        </span>
    );
}

export default InfoTip;
