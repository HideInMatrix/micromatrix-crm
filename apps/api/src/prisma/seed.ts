import 'dotenv/config'
import { db } from './db.js'

async function main() {
  await db.connect()
  try {
    const seedMode = process.env['SEED_MODE'] ?? 'demo'
    if (seedMode === 'bootstrap') {
      const { runBootstrapSeed } = await import('./seed-bootstrap.js')
      await runBootstrapSeed(db)
      return
    }
    const { runDemoSeed } = await import('./seed-demo.js')
    await runDemoSeed(db)
  } finally {
    await db.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
