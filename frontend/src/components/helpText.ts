// One place for every plain-language explanation on the dashboard, so the
// wording stays the same on every page.
export const HELP = {
    revenue:
        "Total sales: what customers paid, incl. shipping and taxes, minus refunds. Same as Shopify's \"Total sales\". Compared with the same weekday in earlier weeks, because Mondays and Saturdays behave differently.",
    quiltOrders: "Orders today that include at least one quilt. Too small a number to compare as a %, so only yesterday's count is shown.",
    conversionRate:
        "Out of every 100 store visits (sessions), how many placed an order. From Shopify Analytics, human visits only (bots excluded), same as Shopify's own reports. \"pts\" = percentage points: 2.0% → 2.5% is +0.5 pts.",
    orders: "Number of paid or pending orders (cancelled and test orders are left out).",
    openAlerts: "Alerts that fired and aren't resolved yet. Manage the rules on the Alarm Rules page.",
    aov: "Average order value = (gross sales − discounts) ÷ orders, before shipping and tax. Same definition as Shopify.",
    salesOverTime:
        "Total sales per day. Solid line = the last 14 complete days, dashed line = the 14 days before. Orange markers = changes from the Change Log.",
    salesBreakdown:
        "How we get from gross sales to total sales, same rows as Shopify Analytics. Green = good for the store, red = bad (so more discounts or refunds show in red).",
    cvrTrend:
        "Daily conversion rate (line) with sessions behind it (grey bars). A dip with normal sessions usually means a site or offer problem; a dip with a traffic spike often means low-quality traffic.",
    alarms: "Automatic checks that watch the store and raise an alert when something looks wrong.",
    topProducts: "Best-selling products today, by revenue.",
    ordersTrend: "Orders per day for the last 7 days, in the store's timezone.",
    funnel:
        "How many visitors made it through each step to a purchase. \"% of previous step\" shows where people drop off. Green/red pts = better/worse than the same weekday last week.",
    orderHealth: "Share of the last 30 days' orders that were paid, refunded, cancelled or still pending.",
    tooEarly:
        "\"Too early to compare\" means there isn't enough data yet (fewer than ~20 orders or ~500 sessions), so a % change would mostly be luck.",
    deviceSplit: "Same numbers split by mobile, desktop and tablet. Look for one device converting much lower than the others.",
    channelSplit:
        "Same numbers split by where visitors came from (social, search, email, direct…). Revenue / session shows which traffic is worth the most.",
    productWindow:
        "Last 28 complete days. A long window gives each product enough visits to judge it fairly; changes compare with the 28 days before.",
    productGroups:
        "Each product is compared with its own category (quilts with quilts), using an adjusted conversion rate so a product with very few views can't top the list by luck. Stars: many views, high conversion. Hidden gems: few views, high conversion. Leaky: many views, low conversion. Dead weight: few views, low conversion.",
    fixFirst:
        "Leaky products ranked by revenue left on the table = views × (category conversion − product conversion) × price. Fix the top one first.",
    categories: "Revenue and orders per product category for the last 28 days, vs the 28 days before.",
    productTable:
        "Items sold, orders and net sales come from Shopify (same as its \"Total sales by product\" report). Views = real people (bots removed) who opened the product page, from Microsoft Clarity. View → order = orders ÷ views over the same days that have Clarity data.",
};
