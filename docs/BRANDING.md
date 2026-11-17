# Branding

Two separate things on the splash page, kept deliberately apart:

- **The hotspot's own name** — `SITE_NAME` in `.env` (default `"Mamba WiFi"`), shown by [`SiteLogo`](../src/components/portal/site-logo.tsx) and in the page `<title>`/meta description ([`layout.tsx`](../src/app/layout.tsx)). Every deployer of this app runs a different network, so this is the one piece of branding meant to be rebranded per deployment — just change the env var, no code edit needed.
- **"Built by Open Tech Africa"** — a fixed footer link ([`VendorAttribution`](../src/components/portal/vendor-attribution.tsx)), hardcoded (not configurable) and pointed at `https://opentechafrica.com`. This is intentionally *not* folded into `SiteLogo` or `SITE_NAME`: if it were, a deployer rebranding their own hotspot name would strip the credit at the same time, with no separate step to think twice about. Keeping it a distinct component that nothing else touches is what lets it survive across however many WISPs end up running this once it's public — the same mechanism as a "Built with Shopify"/"Powered by Stripe" badge.

If you fork this for your own deployment: changing `SITE_NAME` is expected and fine. Removing `VendorAttribution` is a deliberate choice to make on your own, not something that happens as a side effect of rebranding.
