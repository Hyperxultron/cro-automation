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
        "Total sales per day (complete days only, so today isn't included). Green line = the dates shown in green; grey dashed line = the same number of days just before. Hover a day to see both dates and their sales. Orange dots = changes logged in the Change Log.",
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
    categories: "Per category, last 28 days vs the 28 days before. Products = how many different products sold. Items sold = total pieces. Orders = orders with at least one product from this category (an order with 3 tablecloths counts once). \"New / low before\" = it sold almost nothing in the earlier 28 days, so a % change would be misleading.",
    productTable:
        "Items sold, orders and net sales come from Shopify (same as its \"Total sales by product\" report). Views = real people (bots removed) who opened the product page, from Microsoft Clarity. View → order = orders ÷ views over the same days that have Clarity data.",
    landingPages:
        "Landing page = the first page a visitor opened. Bounce rate = share of visits that saw only that one page and left (Shopify's definition, bots excluded). Conversion = share of visits that placed an order. Revenue / session = sales from visits that started on this page ÷ its sessions. A red flag means bounce is 5+ points worse than the same page in the previous period.",
    pageTypes:
        "Each page type has a different job: Home should send people to collections, Collection to products, Product to the cart. Judge each type against its own past, not against the others.",
    bounceBySource:
        "Same bounce rate split by where visitors came from. A high bounce from one source (e.g. Social) usually means the ad or post promised something the page doesn't show.",
    bounceByDevice:
        "Bounce rate by device. If mobile is much worse than desktop, check the mobile page (speed, pop-ups, layout).",
    webVitals:
        "How fast the store feels to real visitors, measured by Shopify on every page load. We show the p75: 75% of page loads were at least this good (Google's own rule). LCP = how long until the main image or text shows (good: 2.5 s or less). INP = how quickly the page reacts to a tap (good: 200 ms or less). CLS = how much the page jumps around while loading (good: 0.1 or less). Green = good, amber = needs work, red = poor.",
    siteSearch:
        "How many visitors use the search box and whether it helps them buy. If searchers convert much better than non-searchers, make search easier to find. Zero-result terms are words people typed that found nothing: add those products, synonyms or redirects.",
    payments:
        "Payment success rate = successful payments ÷ purchase attempts (a customer retrying the same purchase counts once). A method with a much lower success rate than the others usually means a gateway or card-decline problem.",
    orderValues:
        "How much each order is worth (after discounts, before shipping and tax). If you set your free-shipping threshold, the shaded bars show orders just below it: those customers might add one more item for free shipping.",
    itemsPerOrder:
        "How many pieces people buy per order. A high share of 1-item orders means bundles, 'complete the set' or cross-sells could raise order value.",
};
