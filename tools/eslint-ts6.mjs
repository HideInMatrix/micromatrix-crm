import path from 'node:path'
import Module, { createRequire } from 'node:module'

const requireFromRoot = createRequire(path.join(process.cwd(), 'package.json'))
const originalResolveFilename = Module._resolveFilename

// typescript-eslint still requires the TypeScript 6 JavaScript API. Keep the
// project's compiler on TypeScript 7 and redirect only this lint process to
// the isolated TS6 compatibility package.
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === 'typescript') return requireFromRoot.resolve('@typescript/old')
  if (request.startsWith('typescript/')) {
    return requireFromRoot.resolve(`@typescript/old/${request.slice('typescript/'.length)}`)
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

const eslintApi = requireFromRoot.resolve('eslint')
const eslintBin = path.join(path.dirname(eslintApi), '..', 'bin', 'eslint.js')
process.argv = [process.execPath, eslintBin, ...process.argv.slice(2)]
requireFromRoot(eslintBin)
