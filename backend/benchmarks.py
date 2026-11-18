"""
Static CRO industry benchmarks, used to give store metrics context on the dashboard.

These are well-established, widely-cited e-commerce averages (not pulled live from
any API) sourced from Baymard Institute's cart/checkout abandonment research and
common e-commerce conversion-rate industry reports. They are shown as reference
points, clearly labeled with their source, never presented as this store's own data.
"""

BENCHMARKS = {
    "cart_abandonment_rate": {
        "value": 70.0,
        "label": "Avg. online cart abandonment rate",
        "source": "Baymard Institute (commonly cited e-commerce industry average)",
    },
    "checkout_abandonment_rate": {
        "value": 69.0,
        "label": "Avg. checkout abandonment rate",
        "source": "Baymard Institute (commonly cited e-commerce industry average)",
    },
    "conversion_rate": {
        "value": 2.5,
        "label": "Avg. e-commerce conversion rate",
        "source": "Commonly cited e-commerce industry average (varies 2-3% by sector)",
    },
}


def get_benchmarks() -> dict:
    return BENCHMARKS
