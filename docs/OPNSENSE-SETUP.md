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

## 3. Redirecting to this app instead of OPNsense's built-in splash page

OPNsense serves its own HTML template for unauthenticated clients, with template variables including `$zoneid`, `$clientip`, and `$redirurl` (the URL the client originally tried to reach). Replace that template's body with a minimal page that immediately forwards the browser to this app, keeping those values as query params:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="refresh" content="0; url=https://portal.example.com/?zoneid=$zoneid&clientip=$clientip&redirurl=$redirurl" />
  </head>
  <body></body>
</html>
```

(Configured under the zone's **Portal page contents** upload.) This app's `/` route reads those query params and carries them through the whole flow (stored on `PortalSession`) so it knows which zone to log the client back into.

## 4. Logging the client in once payment clears

OPNsense's captive portal accepts a plain HTTP POST to the zone's logon URL — this is the same endpoint its own login form posts to:

```
POST https://<opnsense-host>:8003/index.php?zone=<zoneid>
Content-Type: application/x-www-form-urlencoded

auth_user=<radiusUsername>&auth_pass=<radiusPassword>&accept=Continue&redirurl=<redirurl>&zone=<zoneid>
```

(Port and path depend on whether the portal is bound to HTTPS and the configured port — confirm against the live OPNsense instance; the exact field names have shifted across OPNsense versions, verify against `Services > Captive Portal` docs for the installed version before wiring this up.)

This app's `/connecting` page (shown once `PortalSession.status === "PROVISIONED"`) auto-submits a hidden form with those fields via the client's own browser — this matters because the POST has to originate from the subscriber's device (the captive portal keys the session off the client's IP/MAC), not from this app's server. On success, OPNsense redirects the browser to the original `redirurl` with normal internet access now flowing.

If the self-signed certificate on OPNsense's captive portal port is a problem for the auto-submit (mixed content / cert warnings), terminate it with a proper certificate (internal CA trusted by nothing external is fine — it's LAN-only traffic from the client to the gateway) or proxy that specific POST through this app's backend only if the client's IP can be forwarded faithfully (prefer the direct client-side POST where possible, since it preserves the IP/MAC binding OPNsense relies on).

## 5. FreeRADIUS side

Already covered by the daloRADIUS install guide: `client_table = "nas"` in `sql.conf`, the `nas` table has the row for OPNsense added in step 1, and `radcheck`/`radreply`/`radusergroup` drive authentication and reply attributes. Nothing extra to configure here beyond what the guide sets up — this app just writes rows into tables FreeRADIUS is already reading. With accounting enabled in step 2, FreeRADIUS also needs `acct_table` wired (the install guide's `sql.conf` already does this), so `radacct` fills in as sessions start/stop.

## Open items to confirm against the live OPNsense version before building the auto-login step

- Exact captive portal logon endpoint path/port and field names for the installed OPNsense version (these have changed across major versions)
- Whether the zone is configured for HTTP or HTTPS on the portal page, and how that affects posting from `https://portal.example.com`
- Bandwidth attribute the AP vendor actually honors from `radreply` (MikroTik vs. generic WISPr vs. vendor-specific VSA) — confirm against the AP hardware in use
