import 'dotenv/config'
import { db } from './db.js'
import { runBootstrapSeed } from './seed-bootstrap.js'

async function main() {
  await db.connect()
  try {
    await runBootstrapSeed(db)
  } finally {
    await db.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
