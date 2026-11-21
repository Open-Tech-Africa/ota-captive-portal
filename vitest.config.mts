import path from "node:path"
import { defineConfig } from "vitest/config"

/**
 * A separate database on the same local Postgres as `pnpm docker:db`, so tests can wipe it freely
 * without touching dev data. Override with TEST_DATABASE_URL (e.g. a CI service container); the
 * database name must still end in `_test` — see test/assert-test-database.ts.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://portal:portal_dev_password@localhost:5435/wisp_portal_test"

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.resolve(import.meta.dirname, "src")}/` },
      // `server-only` throws unless imported under React's server condition, which only Next's
      // bundler sets. Tests are server-side by definition, so use its no-op export directly.
      {
        find: /^server-only$/,
        replacement: path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
      },
    ],
  },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl },
    // Every test file shares the one test database, so files must not run at the same time.
    fileParallelism: false,
  },
})
