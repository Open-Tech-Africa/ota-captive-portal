# OPNsense + FreeRADIUS wiring

This app assumes the networking side is built per the [daloRADIUS Debian install guide](https://github.com/lirantal/daloradius/wiki/Install-daloRADIUS-on-Debian) (FreeRADIUS 3.x + MariaDB + daloRADIUS on Debian) plus OPNsense in front of the AP as the captive portal gateway. This doc covers the OPNsense-side config this app depends on — it's infra setup, not app code, but the app's redirect/login steps only work if this is wired correctly.

## 1. Register OPNsense as a NAS in daloRADIUS

OPNsense's captive portal is itself the RADIUS **NAS client** — FreeRADIUS needs a matching `nas` row before it will accept Access-Requests from it. In daloRADIUS: `Management > NAS`, add an entry for OPNsense's **portal-interface IP** (the interface the hotspot VLAN sits on, not the WAN IP), with a shared secret you generate. Vendor can be left as generic/other — OPNsense doesn't need a vendor-specific RADIUS dictionary for basic auth + accounting. This secret is reused as-is in step 2.

## 2. Captive Portal zone

`Services > Captive Portal > Administration`, create (or edit) a zone for the hotspot VLAN/interface:

- **Interfaces**: the VLAN/interface the AP's clients land on
- **Maximum concurrent connections**, idle/hard timeout: leave generous — the real session limit comes from FreeRADIUS's `Session-Timeout`, not OPNsense's own timeout (double-enforcing both is fine as a safety net, just make OPNsense's longer than any package)
- **Authentication method**: **RADIUS Authentication** (`System > Access > Servers`, add a RADIUS server entry for the FreeRADIUS host) — **Authentication port 1812**, **Accounting port 1813 with accounting enabled**, shared secret matching the NAS entry from step 1 exactly.
- **Accounting is not optional here**: with it enabled, FreeRADIUS populates `radacct` (session start time, bytes in/out) for every portal session. The app's package logic needs `radacct`'s session-start timestamp to know when an hourly/daily/weekly pass actually began, not just the `Session-Timeout` value stored in `radcheck` — see [`RADIUS-INTEGRATION.md`](RADIUS-INTEGRATION.md#radacct-and-package-expiry).
- **SSL certificate**: leave empty for HTTP only, or pick a cert for HTTPS — OPNsense's own manual recommends a **publicly trusted certificate** on the zone for the modern portal API (self-signed causes mixed-content/cert-warning problems for the auto-login POST in step 4; an internal-CA cert trusted by nothing external is *not* sufficient here since the client's browser itself has to trust it).
- **Hostname**: where OPNsense's own login flow redirects. Leave blank to use the interface IP (simplest — no DNS dependency), or set it only if you've already got a resolvable internal name for the zone; if set alongside a certificate, the hostname must match the cert's name.
- Note the zone's **port**: HTTP (80) is internally redirected to `127.0.0.1:9000+zoneid`, HTTPS (443) to `127.0.0.1:8000+zoneid` — e.g. zone 3 serves its portal page directly on `:8003`. This is the port used in steps 3 and 4 below, and in the WebGUI-exposure fix in step 5.

## 3. Redirecting to this app instead of OPNsense's built-in splash page

OPNsense's unauthenticated-client template supports variables including `$zoneid`, `$clientip`, and `$redirurl` (the URL the client originally tried to reach) — but these are only substituted inside a proper **Template**, not inside an arbitrary HTML paste. Build it the way OPNsense's own manual describes:

1. `Services > Captive Portal > Templates` → download the **default template** (a zip file).
2. Unpack it, and replace the body of its `index.html` with a minimal page that immediately forwards the browser to this app, carrying those three variables as query params:
   ```html
   <!DOCTYPE html>
   <html>
     <head>
       <meta http-equiv="refresh" content="0; url=http://<server-LAN-IP>:3000/?zoneid=$zoneid&clientip=$clientip&redirurl=$redirurl" />
     </head>
     <body></body>
   </html>
   ```
3. Repack the edited folder as a new zip, upload it under the Templates tab, then select it in the zone's **Custom template** dropdown (`Services > Captive Portal > Administration`).

**Use the server's LAN IP here, not the public tunnel URL.** Hotspot clients are already on the local network — there's no reason to send their browser out to the internet and back through Cloudflare just to load a page sitting on the same LAN. `web-prod` already publishes `3000:3000` to the host (see [docker-compose.yml](../docker-compose.yml)), so `http://<server-LAN-IP>:3000` is directly reachable from the hotspot VLAN. The public tunnel is still required, but only for the M-Pesa/Paystack callback URL (step 4's auto-login POST and the app's internal API calls are unaffected either way — they're relative to whatever origin the client loaded the page from).

This app's `/` route reads those query params and carries them through the whole flow (stored on `PortalSession`) so it knows which zone to log the client back into.

**Walled garden**: add the server's LAN IP to the zone's **Allowed addresses** field so unauthenticated clients can actually reach it post-redirect — without this, the client's request to `<server-LAN-IP>:3000` gets intercepted by the portal again and loops back on itself. Note this field is IP/subnet-based only (there's a separate **Allowed MAC addresses** field too) — there's no hostname-based walled-garden entry, which is another reason to redirect to a bare LAN IP rather than a DNS name.

## 4. Logging the client in once payment clears

OPNsense's captive portal accepts a plain HTTP POST to the zone's logon URL — this is the same endpoint its own login form posts to, on the `8000 + zoneid` port confirmed in step 2 (zone 3 → `:8003`, etc.):

```
POST https://<opnsense-host>:<8000+zoneid>/index.php?zone=<zoneid>
Content-Type: application/x-www-form-urlencoded

auth_user=<radiusUsername>&auth_pass=<radiusPassword>&accept=Continue&redirurl=<redirurl>&zone=<zoneid>
```

The exact **field names** (`auth_user`/`auth_pass`/etc.) are not documented in OPNsense's own manual and have shifted across major versions — confirm these against the installed version's actual login form (view its source) before wiring this up; only the port/path formula above is confirmed.

This app's `/connecting` page (shown once `PortalSession.status === "PROVISIONED"`) auto-submits a hidden form with those fields via the client's own browser — this matters because the POST has to originate from the subscriber's device (the captive portal keys the session off the client's IP/MAC), not from this app's server. On success, OPNsense redirects the browser to the original `redirurl` with normal internet access now flowing.

## 5. Restricting authenticated clients from reaching the WebGUI

**Not optional for a public hotspot.** By default, OPNsense only blocks *unauthenticated* clients from everything except DNS and the portal page — once a client authenticates, they're no longer redirected at all, which means their request to port 443 lands on the regular OPNsense **WebGUI** admin login (via `/api/captiveportal/access/api`), not just normal internet access. Any paying customer can otherwise reach your router's own admin login page.

Fix (per OPNsense's own manual): on the hotspot zone's interface, add a **destination NAT rule** forwarding TCP 443 → `127.0.0.1:<8000+zoneid>`, plus a matching pass rule. This keeps authenticated clients routed to the captive portal's own HTTPS port instead of the WebGUI. If the zone's auto-generated rules get in the way of adding this, the zone has a **Disable firewall rules** toggle to suppress the automatic redirect/block rules and write your own instead.

If you're on OPNsense 25.1.4/25.10 or newer, note the old "Allow Inbound" toggle on the zone was removed — inbound access is now governed entirely by the source network's own ruleset, so this NAT+pass rule (and possibly an explicit block rule on non-captive interfaces) may need to be added by hand rather than relying on a zone checkbox. Confirm against the installed version.

## 6. FreeRADIUS side

Already covered by the daloRADIUS install guide: `client_table = "nas"` in `sql.conf`, the `nas` table has the row for OPNsense added in step 1, and `radcheck`/`radreply`/`radusergroup` drive authentication and reply attributes. Nothing extra to configure here beyond what the guide sets up — this app just writes rows into tables FreeRADIUS is already reading. With accounting enabled in step 2, FreeRADIUS also needs `acct_table` wired (the install guide's `sql.conf` already does this), so `radacct` fills in as sessions start/stop.

## Open items to confirm against the live OPNsense version

- Exact captive portal logon POST field names for the installed OPNsense version (the port/path formula is confirmed — `8000+zoneid` — but field names aren't documented upstream and have shifted across major versions)
- Whether "Allow Inbound" is present on your installed version, or already removed (25.1.4/25.10+) — changes how step 5's NAT rule needs to be built
- Bandwidth attribute the AP vendor actually honors from `radreply` (MikroTik vs. generic WISPr vs. vendor-specific VSA) — confirm against the AP hardware in use
- IPv6 client roaming needs **Client Roaming** enabled plus Hostwatch and a resolvable zone hostname (Unbound's DNS64 can synthesize one) — only relevant if hotspot clients get IPv6; skip otherwise
