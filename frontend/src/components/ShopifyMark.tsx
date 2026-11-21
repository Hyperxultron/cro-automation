// Small Shopify shopping-bag mark, shown where the dashboard says its data comes from Shopify.
export default function ShopifyMark({ size = 28 }: { size?: number }) {
    return (
        <svg width={size} height={size * 1.14} viewBox="0 0 28 32" aria-label="Shopify" role="img">
            <path d="M9 9.5V8a5 5 0 0 1 10 0v1.5" stroke="#5e8e3e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            <path d="M3.2 9.5h21.6l1.9 19.2a2 2 0 0 1-2 2.3H3.3a2 2 0 0 1-2-2.3z" fill="#95bf47" />
            <path d="M24.8 9.5l1.9 19.2a2 2 0 0 1-2 2.3H20z" fill="#5e8e3e" />
            <path d="M17.6 15.2c-.7-.5-1.7-.8-2.8-.8-2 0-3.3 1.1-3.3 2.6 0 2.9 4.9 2.3 4.9 4.3 0 .8-.7 1.3-1.9 1.3-1.1 0-2.2-.4-3-1" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
    );
}
