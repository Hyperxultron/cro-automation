interface Window {
  shopify?: {
    idToken: () => Promise<string>;
  };
}