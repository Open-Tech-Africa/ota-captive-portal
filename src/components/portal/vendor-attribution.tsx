// Fixed across every deployment of this app, unlike SiteLogo's configurable SITE_NAME — the
// point is this credit keeps shipping to subscribers even when a WISP rebrands the splash page
// for their own network. See docs/BRANDING.md.
const VENDOR_URL = "https://opentechafrica.com"

export function VendorAttribution() {
  return (
    <a
      href={VENDOR_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline"
    >
      Built by <span className="text-primary font-semibold">Open Tech Africa</span>
    </a>
  )
}
