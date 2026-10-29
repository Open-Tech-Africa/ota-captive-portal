const STORAGE_KEY = "wisp-portal:last-phone-number"

/**
 * Per-device convenience only — never a source of truth. localStorage can be unavailable
 * (private browsing, blocked site data) or simply not carry over (many phones open captive
 * portals in an ephemeral OS webview that discards storage once the portal closes). Every call
 * fails silently so a subscriber can still type their number and pay either way.
 */
export function readSavedPhoneNumber(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveSavedPhoneNumber(phoneNumber: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, phoneNumber)
  } catch {
    // Unavailable — nothing to do, the subscriber just types it again next time.
  }
}
