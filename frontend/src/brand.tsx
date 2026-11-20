import { useId } from "react";

// App ka naam aur logo - sirf yahin badlo, poori app mein badal jaayega.
export const BRAND = {
    name: "Ridhi Pulse",
    tagline: "CRO Analytics",
    // Logo options: "tide" | "funnel" | "ring" | "steps"
    logo: "tide" as LogoVariant,
};

export type LogoVariant = "tide" | "funnel" | "ring" | "steps";

export function Logo({ size = 36, variant = BRAND.logo, className = "" }: { size?: number; variant?: LogoVariant; className?: string }) {
    const id = useId().replace(/:/g, "");
    const common = { width: size, height: size, viewBox: "0 0 40 40", className: `shrink-0 ${className}`, "aria-hidden": true } as const;

    if (variant === "funnel") {
        return (
            <svg {...common}>
                <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1e3a8a" /><stop offset="1" stopColor="#06b6d4" /></linearGradient></defs>
                <rect width="40" height="40" rx="11" fill={`url(#${id})`} />
                <path d="M8.5 10.5h17.5l-6.6 8v9l-4.3 2.2v-11.2z" fill="#fff" fillOpacity=".9" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M23.5 27l7-7M25.3 19.6h5.2v5.2" stroke="#5eead4" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (variant === "ring") {
        return (
            <svg {...common}>
                <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5eead4" /><stop offset="1" stopColor="#38bdf8" /></linearGradient></defs>
                <rect width="40" height="40" rx="11" fill="#0b2f47" />
                <circle cx="20" cy="20" r="11" stroke="#fff" strokeOpacity=".14" strokeWidth="4" fill="none" />
                <path d="M20 9a11 11 0 1 1-11 11" stroke={`url(#${id})`} strokeWidth="4" fill="none" strokeLinecap="round" />
                <path d="M16 23.5l4-4.5 4 4.5M20 19v7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (variant === "steps") {
        return (
            <svg {...common}>
                <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0f4c75" /><stop offset="1" stopColor="#0e7490" /></linearGradient></defs>
                <rect width="40" height="40" rx="11" fill={`url(#${id})`} />
                <rect x="9" y="22" width="6" height="9" rx="2" fill="#fff" fillOpacity=".45" />
                <rect x="17" y="16" width="6" height="15" rx="2" fill="#fff" fillOpacity=".75" />
                <rect x="25" y="9" width="6" height="22" rx="2" fill="#5eead4" />
            </svg>
        );
    }
    return (
        <svg {...common}>
            <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0e7490" /><stop offset="1" stopColor="#2dd4bf" /></linearGradient></defs>
            <rect width="40" height="40" rx="11" fill={`url(#${id})`} />
            <path d="M8 29.5c2.7 0 2.7-2.2 5.4-2.2s2.7 2.2 5.4 2.2 2.7-2.2 5.4-2.2 2.7 2.2 5.4 2.2" stroke="#fff" strokeOpacity=".5" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M8.5 22.5C13 22.5 14 17 18 17s4.5 3.5 8.5-3.5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M22.8 11.2h5.4v5.4" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
