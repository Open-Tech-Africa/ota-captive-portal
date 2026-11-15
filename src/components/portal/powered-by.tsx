type Provider = "mpesa" | "paystack"

export function PoweredBy({ provider }: { provider: Provider }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <span className="text-muted-foreground text-xs">Payments secured by</span>
      {provider === "mpesa" ? <MpesaMark /> : <PaystackMark />}
    </div>
  )
}

// Original mark inspired by M-Pesa's green branding — not a reproduction of Safaricom's logo.
function MpesaMark() {
  return (
    <svg
      width="92"
      height="22"
      viewBox="0 0 92 22"
      role="img"
      aria-label="M-Pesa"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0" y="1" width="20" height="20" rx="5" fill="#3FAE2A" />
      <path
        d="M5.5 15.5V7.5L10 12.5L14.5 7.5V15.5"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <text
        x="26"
        y="15.5"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="13"
        fontWeight="700"
        letterSpacing="0.3"
        fill="#3FAE2A"
      >
        M-PESA
      </text>
    </svg>
  )
}

// Original mark inspired by Paystack's navy/cyan branding — not a reproduction of Paystack's logo.
function PaystackMark() {
  return (
    <svg
      width="112"
      height="22"
      viewBox="0 0 112 22"
      role="img"
      aria-label="Paystack"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0" y="1" width="20" height="20" rx="5" fill="#0A2540" />
      <path
        d="M6 15.5V7.5H11.5C13.5 7.5 14.8 8.6 14.8 10.4C14.8 12.2 13.5 13.3 11.5 13.3H8.3V15.5"
        stroke="#00C3F7"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <text
        x="26"
        y="15.5"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="13"
        fontWeight="700"
        letterSpacing="0.3"
        fill="#0A2540"
      >
        PAYSTACK
      </text>
    </svg>
  )
}
