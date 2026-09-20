#!/usr/bin/env node

import { createRequire } from 'node:module'
import process from 'node:process'
import { createCli, loadConfig } from '@prisma/cli-engine'
import { ormCommandFamily } from '@prisma/orm-toolchain/cli'

const require = createRequire(import.meta.url)
const { version: ormToolchainVersion } = require('@prisma/orm-toolchain/package.json')

const commandNames = [
  'contract emit',
  'db migrate',
  'db sign',
  'db verify',
  'migration check',
  'migration status',
]

const commands = Object.fromEntries(
  commandNames.map((name) => {
    const command = ormCommandFamily.commands[name]
    if (!command) throw new Error(`Prisma ORM command is unavailable: ${name}`)
    return [name, command]
  }),
)

const cli = createCli({
  name: 'prisma-orm',
  version: ormToolchainVersion,
  commandFamilies: [ormCommandFamily],
  groups: {
    contract: { brief: 'Contract operations' },
    db: { brief: 'Database operations' },
    migration: { brief: 'Migration operations' },
  },
  commands,
  help: {
    tagline: 'MicroMatrix Prisma ORM migration runtime',
  },
})

const stdin = {
  ...(process.stdin.isTTY && process.stdin.setRawMode
    ? {
        setRawMode(enabled) {
          process.stdin.setRawMode(enabled)
        },
      }
    : {}),
  [Symbol.asyncIterator]: () => process.stdin[Symbol.asyncIterator](),
}

const runtime = {
  stdout: {
    write(text) {
      process.stdout.write(text)
    },
  },
  stderr: {
    write(text) {
      process.stderr.write(text)
    },
    get columns() {
      return process.stderr.columns
    },
  },
  stdin,
  cwd: process.cwd(),
  env: process.env,
  isTty: {
    stdin: process.stdin.isTTY === true,
    stdout: process.stdout.isTTY === true,
    stderr: process.stderr.isTTY === true,
  },
  exit(code) {
    process.exit(code)
  },
  onSignal(callback) {
    const onSigint = () => callback('SIGINT')
    const onSigterm = () => callback('SIGTERM')
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
    return () => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
  },
  loadConfig(configPath) {
    return loadConfig(process.cwd(), configPath, ormToolchainVersion)
  },
  managementApi: {
    baseUrl: 'https://api.prisma.io',
  },
  host: {
    runtime: {
      name: 'node',
      version: process.version,
    },
    platform: process.platform,
    arch: process.arch,
  },
}

process.exitCode = await cli.run(process.argv.slice(2), runtime)
