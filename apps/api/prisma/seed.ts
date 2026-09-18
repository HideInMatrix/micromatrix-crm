import 'dotenv/config'

async function main() {
  const seedMode = process.env['SEED_MODE'] ?? 'demo'
  if (seedMode === 'bootstrap') {
    const { runPrisma8BootstrapSeed } = await import('./seed-bootstrap-prisma8.js')
    await runPrisma8BootstrapSeed()
    return
  }
  const { runPrisma8DemoSeed } = await import('./seed-demo-prisma8.js')
  await runPrisma8DemoSeed()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
