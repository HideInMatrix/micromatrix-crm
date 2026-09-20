import path from 'node:path'
import { createRequire } from 'node:module'

const requireFromWorkspace = createRequire(path.join(process.cwd(), 'package.json'))
const { run } = requireFromWorkspace('vue-tsc')
const tscPath = requireFromWorkspace.resolve('@typescript/old/lib/tsc')

run(tscPath)
