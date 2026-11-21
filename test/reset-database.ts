import { appDb } from "@/lib/db/app"
import { assertIsTestDatabase } from "./assert-test-database"

/** Empties every table, so each test starts from a blank database. */
export async function resetDatabase(): Promise<void> {
  // Checks the URL appDb actually connected with, not the one we meant to give it.
  assertIsTestDatabase(process.env.DATABASE_URL)

  await appDb.$executeRawUnsafe(
    'TRUNCATE "RadiusProvisionLog", "MpesaTransaction", "PaystackTransaction", "PortalSession", "Package" CASCADE',
  )
}
