"use client"

import { useEffect, useRef } from "react"
import type { z } from "zod"
import type { captivePortalLogonSchema } from "@/lib/schemas/session"

type CaptivePortalLogon = z.infer<typeof captivePortalLogonSchema>

/** Renders and immediately submits the hidden form that logs this browser into OPNsense. */
export function CaptivePortalAutoLogin({ logon }: { logon: CaptivePortalLogon }) {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    formRef.current?.submit()
  }, [])

  return (
    <form ref={formRef} action={logon.action} method="POST" className="hidden">
      {Object.entries(logon.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </form>
  )
}
