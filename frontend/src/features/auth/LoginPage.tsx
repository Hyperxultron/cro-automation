import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Lock, LogIn, User } from "lucide-react";
import { BRAND, Logo } from "../../brand";
import { auth } from "../../services/api";

export default function LoginPage({ onDone }: { onDone: () => void }) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !password) return;
        setBusy(true);
        setError(null);
        try {
            await auth.login(username.trim(), password);
            setPassword("");
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not log in");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="ocean-bg flex min-h-screen items-center justify-center p-4 sm:p-8">
            <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/5 md:grid-cols-2">
                <div className="ocean-side relative hidden flex-col justify-between overflow-hidden p-10 text-white md:flex">
                    <div className="flex items-center gap-3">
                        <Logo size={40} />
                        <div>
                            <p className="text-[17px] font-bold tracking-tight">{BRAND.name}</p>
                            <p className="text-[10px] uppercase tracking-[0.22em] text-[#7fb0c6]">{BRAND.tagline}</p>
                        </div>
                    </div>
                    <div className="relative z-10">
                        <h2 className="text-3xl font-bold leading-tight">Your store's pulse,<br />every day.</h2>
                        <p className="mt-3 max-w-xs text-sm leading-6 text-[#b6d6e6]">
                            Sales, conversion and alerts from Shopify, in one place.
                        </p>
                    </div>
                    <Logo size={260} className="pointer-events-none absolute -bottom-16 -right-16 opacity-[0.12]" />
                </div>

                <form onSubmit={submit} className="flex flex-col justify-center p-8 sm:p-10">
                    <div className="mb-8 flex items-center gap-3 md:hidden">
                        <Logo size={40} />
                        <div>
                            <p className="text-[17px] font-bold tracking-tight text-slate-900">{BRAND.name}</p>
                            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{BRAND.tagline}</p>
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
                    <p className="mt-1 text-sm text-slate-500">Enter your username and password to open the dashboard.</p>

                    <label className="mt-7 block text-sm font-semibold text-slate-700" htmlFor="rp-user">Username</label>
                    <div className="relative mt-2">
                        <User size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            id="rp-user"
                            autoComplete="username"
                            autoFocus
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/15"
                        />
                    </div>

                    <label className="mt-5 block text-sm font-semibold text-slate-700" htmlFor="rp-pass">Password</label>
                    <div className="relative mt-2">
                        <Lock size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            id="rp-pass"
                            type={show ? "text" : "password"}
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-11 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/15"
                        />
                        <button
                            type="button"
                            onClick={() => setShow((v) => !v)}
                            aria-label={show ? "Hide password" : "Show password"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                            {show ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    </div>

                    {error && (
                        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={busy || !username.trim() || !password}
                        className="mt-7 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0e7490] to-[#14b8a6] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-900/15 transition hover:brightness-110 disabled:opacity-50"
                    >
                        <LogIn size={17} />
                        {busy ? "Signing in…" : "Sign in"}
                    </button>
                </form>
            </div>
        </div>
    );
}
