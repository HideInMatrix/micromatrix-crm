import { spawnSync } from 'node:child_process'
import { delimiter } from 'node:path'

const commandEnv = {
  ...process.env,
  PATH: ['/usr/local/bin', '/opt/homebrew/bin', process.env.PATH].filter(Boolean).join(delimiter),
}

function run(program, args, env = {}) {
  const result = spawnSync(program, args, {
    cwd: process.cwd(),
    env: { ...commandEnv, ...env },
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait'])
run('pnpm', ['db:migrate'])
run('pnpm', ['--filter', '@micromatrix/api', 'run', 'db:seed'], { SEED_MODE: 'bootstrap' })
