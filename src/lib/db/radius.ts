import "server-only"
import { PrismaClient } from "@/generated/radius-client"

// This is the shared FreeRADIUS/daloRADIUS database — see docs/RADIUS-INTEGRATION.md.
// Only ever read/write the specific tables documented there; never run migrations against it.
const globalForPrisma = globalThis as unknown as { radiusDb?: PrismaClient }

export const radiusDb = globalForPrisma.radiusDb ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.radiusDb = radiusDb
}
