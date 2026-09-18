import 'dotenv/config'

async function main() {
  const seedMode = process.env['SEED_MODE'] ?? 'demo'
  if (seedMode === 'bootstrap') {
    const { runBootstrapSeed } = await import('./seed-bootstrap.js')
    await runBootstrapSeed()
    return
  }
  const { runDemoSeed } = await import('./seed-demo.js')
  await runDemoSeed()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
