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
- **SSL certificate: leave this empty (HTTP only).** OPNsense's own manual suggests a publicly trusted certificate for the modern portal API, but that's not achievable for a bare LAN IP like a zone's own address (public CAs won't issue for it), and **confirmed empirically**: a self-signed cert here silently breaks step 4's auto-login POST — the client browser refuses the TLS handshake outright (the request never even reaches OPNsense; DevTools shows it failing with zero response headers, not an HTTP error), with no visible error anywhere for this app to catch. HTTP-only avoids this entirely and matches how OPNsense's own default template already operates (`http://` throughout). The credentials sent over it are a RADIUS username plus a one-time password cleared after one read, over LAN-only traffic — an acceptable tradeoff here.
- **Hostname**: where OPNsense's own login flow redirects. Leave blank to use the interface IP (simplest — no DNS dependency).

**Use the hotspot interface's own IP in `OPNSENSE_CAPTIVE_PORTAL_BASE_URL`, never OPNsense's LAN/admin IP.** On a multi-interface OPNsense box (e.g. a separate `HOURLY` interface for hotspot clients and a `LAN` interface for admin access), these have *different* IPs, and the captive portal zone is bound to one specific interface. Pointing at the wrong one (e.g. the LAN IP you use to administer OPNsense, out of habit) doesn't fail loudly — the daemon listens broadly enough to respond, but since the request isn't recognized as arriving on the zone's actual interface, it silently redirects elsewhere instead of ever processing the login. This produces every symptom in steps 3–4 below (redirect loops, no RADIUS Access-Request ever reaching FreeRADIUS) with nothing pointing at "wrong IP" directly — it looks like a cert problem, a CORS problem, or a field-name problem long before anyone thinks to question the IP itself.

The port formula in principle is HTTP (80) → `127.0.0.1:9000+zoneid`, HTTPS (443) → `127.0.0.1:8000+zoneid` — but don't trust this over directly observed evidence for your installation. The reliable way to get the real value: submit a login request (even with throwaway credentials) and read the **`Location` header of whatever redirect comes back** — it names the exact host:port:scheme OPNsense itself considers correct for that client's interface. That's how this deployment's real value (`http://10.0.10.1:8000`, not the LAN IP's `9000`-port guess) was actually found — empirically, not derived from the formula.

## 3. Redirecting to this app instead of OPNsense's built-in splash page

**Confirmed against the installed version's actual default template** (not a guess): there is no server-side `$zoneid`/`$clientip`/`$redirurl` placeholder substitution inside the template HTML at all. Instead, OPNsense loads the portal page with real query params already in the URL, and the page's own JavaScript reads them off `window.location`. The stock template does exactly this for the redirect target:
```js
let redirurl = (new URL(window.location)).searchParams.get('redirurl');
```
Only `redirurl` is confirmed present this way — the default template never reads a `zoneid` or `clientip` param, so don't assume OPNsense supplies them. This app doesn't need either anyway: the zone is implicit in which port `OPNSENSE_CAPTIVE_PORTAL_BASE_URL` points at (see step 2), and the client's real IP is visible to this app's own server the moment the browser requests it directly — no need for OPNsense to pass it through a query param.

Build the custom template the way OPNsense's manual describes, but with real JS instead of placeholder substitution:

1. `Services > Captive Portal > Templates` → download the **default template** (a zip file).
2. Unpack it, and replace `index.html` with a minimal page that reads `redirurl` the same way the stock template does, then immediately forwards the browser to this app:
   ```html
   <!DOCTYPE html>
   <html>
     <head><meta charset="UTF-8" /><title>Redirecting…</title></head>
     <body>
       <script>
         var redirurl = new URLSearchParams(window.location.search).get("redirurl") || "";
         window.location.replace(
           "http://<server-LAN-IP>:3000/?redirurl=" + encodeURIComponent(redirurl)
         );
       </script>
     </body>
   </html>
   ```
3. Repack the edited folder as a new zip, upload it under the Templates tab, then select it in the zone's **Custom template** dropdown (`Services > Captive Portal > Administration`).

**Use the server's LAN IP here, not the public tunnel URL.** Hotspot clients are already on the local network — there's no reason to send their browser out to the internet and back through Cloudflare just to load a page sitting on the same LAN. `web-prod` already publishes `3000:3000` to the host (see [docker-compose.yml](../docker-compose.yml)), so `http://<server-LAN-IP>:3000` is directly reachable from the hotspot VLAN. The public tunnel is still required, but only for the M-Pesa/Paystack callback URL (step 4's auto-login POST and the app's internal API calls are unaffected either way — they're relative to whatever origin the client loaded the page from).

This app's `/` route reads `redirurl` and carries it through the whole flow (stored on `PortalSession.redirectUrl`) so `/connecting` knows where to send the client once they're authenticated.

**Walled garden**: add the server's LAN IP to the zone's **Allowed addresses** field so unauthenticated clients can actually reach it post-redirect — without this, the client's request to `<server-LAN-IP>:3000` gets intercepted by the portal again and loops back on itself. Note this field is IP/subnet-based only (there's a separate **Allowed MAC addresses** field too) — there's no hostname-based walled-garden entry, which is another reason to redirect to a bare LAN IP rather than a DNS name.

**If the app server sits on a different interface/VLAN than the hotspot clients** (e.g. hotspot on an `HOURLY` interface, the server on a separate `INFRA` one) — which is good practice, not a mistake — the walled-garden entry above only clears the *captive portal's own* interception. There's a second, separate gate: the firewall rule (or lack of one) governing routing between those two interfaces. Add an explicit pass rule on the hotspot interface scoped tightly to just this one destination — source: the hotspot subnet, destination: the app server's exact IP, destination port: `3000` only. Don't open the two interfaces to each other more broadly than that; the isolation between hotspot clients and infra is worth keeping everywhere else.

OPNsense evaluates a given interface's rules **top-to-bottom, first match wins** — this pass rule needs to sit *above* the zone's auto-generated "Default Captive Portal block rule," or it never fires regardless of how correctly it's configured. If this stops working after any later change to the zone/interface (re-saving the zone config can reorder or regenerate auto rules), check the rule's position relative to that block rule before assuming something else broke.

## 4. Logging the client in once payment clears

**Confirmed against the installed version's actual default template** — the real login mechanism is a JSON REST API, not a form POST to `index.php?zone=...`:

```
POST <OPNSENSE_CAPTIVE_PORTAL_BASE_URL>/api/captiveportal/access/logon/
Content-Type: application/x-www-form-urlencoded

user=<radiusUsername>&password=<radiusPassword>
```

There's no `zone` field in the request — the zone is implicit in which interface/host/port `OPNSENSE_CAPTIVE_PORTAL_BASE_URL` points at (see step 2's note on confirming this empirically), so this app only ever logs clients into the one zone that URL belongs to. The response is JSON, e.g. `{"clientState": "AUTHORIZED"}` on success; the stock template's own JS checks that field, then does `window.location = 'http://'+redirurl+'?refresh'`.

This app can't replicate that last part directly: the request has to come from the subscriber's own browser (OPNsense keys the captive portal session off the client's IP/MAC, not this app's server), but a cross-origin `fetch()` from this app's page to OPNsense's API isn't guaranteed to have CORS headers permitting a JS-readable response. So `/connecting` (shown once `PortalSession.status === "PROVISIONED"`) instead:

1. Submits a hidden form with `user`/`password`, POSTing to the endpoint above, targeted at a hidden `<iframe>` rather than the visible window — a form POST isn't subject to CORS at all, so this reliably fires regardless of what OPNsense's API allows for cross-origin reads; the response renders invisibly inside the iframe, which this app never needs to read.
2. After a short fixed delay (to give the POST time to land), navigates the visible window to `PortalSession.redirectUrl` itself — mirroring OPNsense's own `?refresh` convention — rather than waiting on a `clientState` check it has no reliable way to perform.

See [`src/lib/opnsense/logon.ts`](../src/lib/opnsense/logon.ts) and [`src/components/portal/captive-portal-auto-login.tsx`](../src/components/portal/captive-portal-auto-login.tsx) for the implementation.

## 5. Restricting authenticated clients from reaching the WebGUI

**Not optional for a public hotspot.** By default, OPNsense only blocks *unauthenticated* clients from everything except DNS and the portal page — once a client authenticates, they're no longer redirected at all, which means their request to port 443 lands on the regular OPNsense **WebGUI** admin login (via `/api/captiveportal/access/api`), not just normal internet access. Any paying customer can otherwise reach your router's own admin login page.

Fix (per OPNsense's own manual): on the hotspot zone's interface, add a **destination NAT rule** forwarding TCP 443 → `127.0.0.1:<the HTTP port confirmed in step 2>` (since step 2 has no HTTPS listener to redirect to once the certificate field is empty), plus a matching pass rule. This keeps authenticated clients routed to the captive portal's own port instead of the WebGUI. If the zone's auto-generated rules get in the way of adding this, the zone has a **Disable firewall rules** toggle to suppress the automatic redirect/block rules and write your own instead.

If you're on OPNsense 25.1.4/25.10 or newer, note the old "Allow Inbound" toggle on the zone was removed — inbound access is now governed entirely by the source network's own ruleset, so this NAT+pass rule (and possibly an explicit block rule on non-captive interfaces) may need to be added by hand rather than relying on a zone checkbox. Confirm against the installed version.

## 6. FreeRADIUS side

Already covered by the daloRADIUS install guide: `client_table = "nas"` in `sql.conf`, the `nas` table has the row for OPNsense added in step 1, and `radcheck`/`radreply`/`radusergroup` drive authentication and reply attributes. Nothing extra to configure here beyond what the guide sets up — this app just writes rows into tables FreeRADIUS is already reading. With accounting enabled in step 2, FreeRADIUS also needs `acct_table` wired (the install guide's `sql.conf` already does this), so `radacct` fills in as sessions start/stop.

## 7. Admin API: live sessions + force disconnect

The admin dashboard's `/admin/sessions` page (see `docs/ADMIN.md`) reads currently-connected
clients and can force one offline, using OPNsense's **main admin REST API** — a different
credential and host from everything above. Steps 1–6 cover the anonymous, client-facing
`access/logon` endpoint the subscriber's own browser POSTs to (scoped to one zone via whichever
port `OPNSENSE_CAPTIVE_PORTAL_BASE_URL` points at); this section covers OPNsense's general API,
which this app's *server* calls directly with a key/secret, not the client's browser.

1. **Generate an API key**: `System > Access > Users`, open the user you want this app to act as
   (a dedicated service account is cleaner than reusing your own login, but either works), scroll
   to **API keys**, click **+**. This downloads a `key:secret` pair — put them straight into
   `OPNSENSE_API_KEY`/`OPNSENSE_API_SECRET`, there's no way to retrieve the secret again later.
2. **Privilege**: that user (or a group it belongs to) needs the Captive Portal API privilege
   (`System > Access > Groups`, or directly on the user under **Effective Privileges** — search for
   "captive portal"). Without it, every call below 403s.
3. **`OPNSENSE_API_BASE_URL`**: OPNsense's **LAN/admin IP**, e.g. `https://10.0.10.1` — deliberately
   *not* the hotspot-interface IP/port used by `OPNSENSE_CAPTIVE_PORTAL_BASE_URL`. This talks to the
   WebGUI's own API, which listens wherever the WebGUI does (see step 5 above for why authenticated
   hotspot clients must never be able to reach this in the first place — that restriction is about
   *subscriber* traffic, not this app's own server-to-server calls, which go out whatever interface
   this app's server actually routes to OPNsense's admin IP on).
4. **TLS**: unlike the hotspot-facing zone (deliberately HTTP-only, see step 2's cert note above),
   the admin GUI is normally HTTPS with OPNsense's own self-signed cert. `OPNSENSE_API_ALLOW_SELF_SIGNED`
   defaults to `true` for exactly that reason — this app's server trusts the cert blindly for this
   one client rather than needing a real CA-issued cert on a box with no public hostname. Set it to
   `false` if you've put a trusted cert on the WebGUI.
5. **Zone id**: `OPNSENSE_CAPTIVE_PORTAL_ZONE_ID` (default `0`) — check
   `Services > Captive Portal > Administration` if you have more than one zone; the session
   list/disconnect calls need it explicitly (unlike the logon endpoint, which infers it from the
   port).

See [`src/lib/opnsense/admin-client.ts`](../src/lib/opnsense/admin-client.ts) and
[`src/lib/schemas/opnsense-session.ts`](../src/lib/schemas/opnsense-session.ts) for the
implementation.

## 8. Traffic Shaper: per-package speed limits

Packages used to carry a `bandwidthAttribute`/`bandwidthValue` pair (e.g. `Mikrotik-Rate-Limit` =
`1M/2M`) sent as a RADIUS reply attribute, on the assumption that OPNsense's captive portal would
honor it the way MikroTik's own hotspot/PPPoE server does. **It never worked**: checking OPNsense's
actual source (`CaptiveportalBackend.php`, `CaptivePortal.xml`) shows it only reads `Session-Timeout`
and `Idle-Timeout` from a RADIUS Access-Accept, plus `Acct-Interim-Interval` for accounting — no
bandwidth field of any kind, under any dictionary. A maintainer explicitly declined to add one
([opnsense/core#6682](https://github.com/opnsense/core/issues/6682)): "no plans to invest in that
direction." Those fields are gone from `Package` now; speed is enforced via OPNsense's own
**Traffic Shaper** API instead.

**How it works**: each package gets a pair of Traffic Shaper *pipes* (one down, one up), created
lazily the first time anyone buys it and cached on `Package.shaperDownPipeUuid`/`shaperUpPipeUuid`.
Each subscriber session gets a pair of *rules* binding their actual IP to those pipes, created once
their browser logs into OPNsense (`/api/sessions/[id]/apply-shaper`, called from `/connecting`) and
removed by the same cleanup job that clears RADIUS credentials on expiry
(`src/lib/radius/cleanup.ts`).

**Setup**:

1. **`OPNSENSE_HOTSPOT_INTERFACE`**: OPNsense's internal interface name for the hotspot
   VLAN/interface (e.g. `opt1`) — check `Interfaces > Overview`. This is *not* an IP and not
   necessarily what step 2 above uses; the Traffic Shaper's rule model keys on the interface name,
   not an address.
2. Reuses the same `OPNSENSE_API_KEY`/`OPNSENSE_API_SECRET` as step 7 — that user/group also needs
   the Traffic Shaper API privilege (search "traffic shaper" under **Effective Privileges**), not
   just Captive Portal.
3. Nothing else to configure by hand — pipes and rules are created/removed entirely through the
   API as subscribers connect and disconnect.

See [`src/lib/opnsense/traffic-shaper.ts`](../src/lib/opnsense/traffic-shaper.ts) for the
implementation, and its module docblock for exactly which OPNsense source files the field
names/request shapes below come from.

**This section carries more unverified assumptions than steps 1–7** — there was no live OPNsense
box to test against while building it. Specifically, confirm before relying on it:

- **Request/response shape**: `add_pipe`/`add_rule` are assumed to take `{"pipe": {...}}` /
  `{"rule": {...}}` JSON bodies and return `{"result": "saved", "uuid": "..."}` — taken from
  `ApiMutableModelControllerBase.php`'s shared `addBase()`, which every OPNsense Settings
  controller uses, so this is the single most load-bearing assumption in the whole feature.
- **Rule `direction` semantics**: this implementation assumes `direction: "in"` on the hotspot
  interface means traffic arriving from the client (their upload) and `"out"` means traffic headed
  to the client (their download) — standard pf/OPNsense convention, but confirm against actual
  throughput once a real subscriber connects, not just that the API call succeeds.
- **Rule evaluation order**: if the hotspot interface already has other Traffic Shaper rules
  (unlikely on a fresh captive-portal-only interface, but check), this app's per-IP rules need to
  be evaluated before any broader catch-all rule for them to take effect — rules are evaluated
  top-to-bottom by `sequence`, and every rule this app creates uses the model's default (`1`).
- **Pipe `mask: "none"`**: each pipe here is only ever matched by rules scoped to one specific IP,
  so no per-source/per-destination hashing is needed on the pipe itself — confirm this doesn't
  conflict with how OPNsense expects pipes to be shared.

## Open items to confirm against the live OPNsense version

- Steps 3 and 4's template mechanics and logon API are confirmed against this installation's actual default template — if the OPNsense version ever changes, re-check `index.html` inside a freshly downloaded default template zip rather than assuming these still hold.
- Whether "Allow Inbound" is present on your installed version, or already removed (25.1.4/25.10+) — changes how step 5's NAT rule needs to be built
- ~~Bandwidth attribute the AP vendor actually honors from `radreply`~~ — resolved: OPNsense's captive portal doesn't honor any bandwidth attribute from RADIUS, under any vendor dictionary. See step 8 for how speed is actually enforced now, and that section's own (more extensive) list of what still needs confirming against a live box.
- IPv6 client roaming needs **Client Roaming** enabled plus Hostwatch and a resolvable zone hostname (Unbound's DNS64 can synthesize one) — only relevant if hotspot clients get IPv6; skip otherwise
- **Unlike steps 1–6, step 7's session list/disconnect shapes are taken from OPNsense's own public docs/source (https://docs.opnsense.org/development/api/core/captiveportal.html), not confirmed against a live instance.** In particular: whether `session/list` returns a JSON array or an object keyed by session ID (`src/lib/schemas/opnsense-session.ts` handles either, but verify which your version actually sends), and whether the response field names (`userName`, `ipAddress`, `macAddress`, `startTime`, `bytes_in`, `bytes_out`) match exactly on your installed version. Check with `curl -u <key>:<secret> -k https://<opnsense-admin-ip>/api/captiveportal/session/list/0/` once deployed.
