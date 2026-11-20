import { PrismaClient } from "../../src/generated/app-client"

const db = new PrismaClient()

async function main() {
  const packages = [
    {
      name: "1 Hour",
      duration: "HOURLY" as const,
      durationMinutes: 60,
      priceKes: 10,
      downKbps: 2_000,
      upKbps: 1_000,
      radiusGroup: "pkg-hourly",
      sortOrder: 0,
    },
    {
      name: "1 Day",
      duration: "DAILY" as const,
      durationMinutes: 60 * 24,
      priceKes: 50,
      downKbps: 4_000,
      upKbps: 2_000,
      radiusGroup: "pkg-daily",
      sortOrder: 1,
    },
    {
      name: "1 Week",
      duration: "WEEKLY" as const,
      durationMinutes: 60 * 24 * 7,
      priceKes: 250,
      downKbps: 6_000,
      upKbps: 3_000,
      radiusGroup: "pkg-weekly",
      sortOrder: 2,
    },
  ]

  for (const pkg of packages) {
    await db.package.upsert({
      where: { id: pkg.radiusGroup },
      update: pkg,
      create: { id: pkg.radiusGroup, ...pkg },
    })
  }

  console.warn(`Seeded ${packages.length} packages`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
