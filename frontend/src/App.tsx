import { useCallback, useEffect, useState } from "react";
import Dashboard from "./features/dashboard/Dashboard";
import LoginPage from "./features/auth/LoginPage";
import ShopifyAuth from "./ShopifyAuth";
import OceanCursor from "./components/OceanCursor";
import { Logo } from "./brand";
import { auth, getToken } from "./services/api";

type Gate = "checking" | "login" | "open";

function App() {
  // ShopifyAuth sirf Shopify Admin (embedded app) ke andar chalta hai.
  // Standalone dashboard (deploy URL) par woh status text nahi dikhega.
  const insideShopify = typeof window !== "undefined" && !!window.shopify;
  const [gate, setGate] = useState<Gate>("checking");

  // Login ON ho toh pehle username/password, warna seedha dashboard.
  const check = useCallback(async () => {
    try {
      const { enabled } = await auth.status();
      if (!enabled) return setGate("open");
      if (!getToken()) return setGate("login");
      await auth.me();
      setGate("open");
    } catch {
      setGate(getToken() ? "open" : "login");
    }
  }, []);

  useEffect(() => {
    check();
    const onLogout = () => setGate("login");
    window.addEventListener("rp:logout", onLogout);
    return () => window.removeEventListener("rp:logout", onLogout);
  }, [check]);

  return (
    <>
      {gate === "checking" && (
        <div className="ocean-bg flex min-h-screen items-center justify-center">
          <Logo size={56} className="animate-pulse" />
        </div>
      )}
      {gate === "login" && <LoginPage onDone={() => setGate("open")} />}
      {gate === "open" && (
        <>
          {insideShopify && <ShopifyAuth />}
          <Dashboard />
        </>
      )}
      <OceanCursor />
    </>
  );
}

export default App;
