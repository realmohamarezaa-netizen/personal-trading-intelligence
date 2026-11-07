// Seed runner: `bun run scripts/seed.ts`
import { reseedDemo } from '../src/lib/seed'
import { db } from '../src/lib/db'

async function main() {
  console.log('⏳ Generating demo trading data...')
  const result = await reseedDemo()
  console.log(`✅ Seeded: ${result.trades} closed trades, ${result.open} open positions, ${result.cashflows} cashflows`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
