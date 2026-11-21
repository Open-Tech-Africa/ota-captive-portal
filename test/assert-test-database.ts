/** Guards against ever wiping a real database: the target's name must end in `_test`. */
export function assertIsTestDatabase(url: string | undefined): void {
  const databaseName = url ? new URL(url).pathname.slice(1) : "(no DATABASE_URL)"
  if (!databaseName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${databaseName}": name must end in _test`)
  }
}
