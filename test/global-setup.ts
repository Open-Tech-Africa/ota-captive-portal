import { execFileSync } from "node:child_process"
import type { TestProject } from "vitest/node"
import { assertIsTestDatabase } from "./assert-test-database"

/** Creates the test database if needed and applies every committed migration to it. */
export default function setup(project: TestProject): void {
  const databaseUrl = project.config.env.DATABASE_URL
  assertIsTestDatabase(databaseUrl)

  execFileSync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema=prisma/app/schema.prisma"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    },
  )
}
