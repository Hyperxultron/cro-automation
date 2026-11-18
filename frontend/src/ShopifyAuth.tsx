import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

function ShopifyAuth() {
  const [status, setStatus] = useState("Connecting to Shopify...");

  useEffect(() => {
    let active = true;

    async function authenticate() {
      try {
        if (!window.shopify) {
          setStatus("Open this app inside Shopify Admin.");
          return;
        }

        const idToken = await window.shopify.idToken();

        const response = await fetch(`${API_URL}/shopify/auth`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });

        if (!response.ok) {
          throw new Error("Shopify authentication failed");
        }

        const result = await response.json();

        if (active) {
          setStatus(
            result.status === "success"
              ? "Shopify store connected successfully!"
              : "Authentication failed."
          );
        }
      } catch {
        if (active) {
          setStatus("Unable to connect Shopify. Please try again.");
        }
      }
    }

    authenticate();

    return () => {
      active = false;
    };
  }, []);

  return <div>{status}</div>;
}

export default ShopifyAuth;