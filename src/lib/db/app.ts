import "server-only"
import { PrismaClient } from "@/generated/app-client"

// Reused across hot reloads in dev so `next dev` doesn't open a new pool on every edit.
const globalForPrisma = globalThis as unknown as { appDb?: PrismaClient }

export const appDb = globalForPrisma.appDb ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.appDb = appDb
}
