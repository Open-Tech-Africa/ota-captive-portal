// Shared by middleware.ts (Edge) and the admin login/logout routes (Node) — kept dependency-free
// so it's safe to import from either runtime.
export const ADMIN_SESSION_COOKIE = "admin_session"
