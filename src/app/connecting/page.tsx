"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { sessionStatusResponseSchema, type SessionStatusResponse } from "@/lib/schemas/session"
import { CaptivePortalAutoLogin } from "@/components/portal/captive-portal-auto-login"

export default function ConnectingPage() {
  return (
    <Suspense fallback={<StatusMessage text="Finishing up your payment…" />}>
      <ConnectingContent />
    </Suspense>
  )
}

function ConnectingContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId")
  const [data, setData] = useState<SessionStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fetchedOnce = useRef(false)

  useEffect(() => {
    if (!sessionId || fetchedOnce.current) return
    fetchedOnce.current = true

    fetch(`/api/sessions/${sessionId}/status?reveal=true`)
      .then((response) => response.json())
      .then((json: unknown) => {
        const parsed = sessionStatusResponseSchema.safeParse(json)
        if (!parsed.success || !parsed.data.captivePortalLogon) {
          setError("We couldn't find your connection details. Go back and try again.")
          return
        }
        setData(parsed.data)
      })
      .catch(() => setError("Couldn't reach the server. Go back and try again."))
  }, [sessionId])

  if (!sessionId) {
    return <StatusMessage text="Missing session — go back and pick a package." />
  }
  if (error) {
    return <StatusMessage text={error} />
  }
  if (!data?.captivePortalLogon) {
    return <StatusMessage text="Finishing up your payment…" />
  }

  return (
    <>
      <StatusMessage text="Connecting you to the internet…" />
      <CaptivePortalAutoLogin logon={data.captivePortalLogon} />
    </>
  )
}

function StatusMessage({ text }: { text: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 text-center">
      <p className="text-lg">{text}</p>
    </main>
  )
}
