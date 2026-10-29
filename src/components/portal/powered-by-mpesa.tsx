// Original mark inspired by M-Pesa's green branding — not a reproduction of Safaricom's logo.
export function PoweredByMpesa() {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <span className="text-muted-foreground text-xs">Payments secured by</span>
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
    </div>
  )
}
