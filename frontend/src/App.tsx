import Dashboard from "./features/dashboard/Dashboard";
import ShopifyAuth from "./ShopifyAuth";

function App() {
  // ShopifyAuth sirf Shopify Admin (embedded app) ke andar chalta hai.
  // Standalone dashboard (deploy URL) par woh status text nahi dikhega.
  const insideShopify = typeof window !== "undefined" && !!window.shopify;

  return (
    <>
      {insideShopify && <ShopifyAuth />}
      <Dashboard />
    </>
  );
}

export default App;