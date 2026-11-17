"use client"

import { useEffect, useRef } from "react"
import type { z } from "zod"
import type { captivePortalLogonSchema } from "@/lib/schemas/session"

type CaptivePortalLogon = z.infer<typeof captivePortalLogonSchema>

const LOGON_IFRAME_NAME = "captive-portal-logon-frame"
// Give the POST a moment to land before leaving the page — OPNsense's own login page reads the
// AJAX response's clientState before deciding where to go next, but we aren't that page and can't
// read the response (it's rendered inside the hidden iframe, not a fetch we control the CORS of).
const NAVIGATE_AFTER_MS = 1_500

/**
 * Logs this browser into OPNsense: submits a hidden form, targeted at a hidden iframe (not the
 * visible window), to OPNsense's captive portal API. A real fetch() isn't used because that API
 * has no guaranteed CORS allowance for a cross-origin caller like this app; a form POST sidesteps
 * CORS entirely and still lets the request land. The POST has to originate from the subscriber's
 * own device, since OPNsense keys the captive portal session off the client's IP/MAC.
 */
export function CaptivePortalAutoLogin({
  logon,
  redirectUrl,
}: {
  logon: CaptivePortalLogon
  redirectUrl: string | null
}) {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    formRef.current?.submit()
    const timer = setTimeout(() => {
      // Mirrors OPNsense's own default template's post-login redirect convention.
      window.location.href = redirectUrl ? `${redirectUrl}?refresh` : "/"
    }, NAVIGATE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [redirectUrl])

  return (
    <>
      <iframe name={LOGON_IFRAME_NAME} title="Captive portal login" className="hidden" />
      <form
        ref={formRef}
        action={logon.action}
        method="POST"
        target={LOGON_IFRAME_NAME}
        className="hidden"
      >
        {Object.entries(logon.fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </form>
    </>
  )
}
