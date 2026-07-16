import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * Finds this package's own version by walking up from wherever this file
 * actually is at runtime and looking for its package.json. Deliberately
 * not a hardcoded relative path: `src/cli/version.ts` sits two directories
 * below the repo root at dev/test time, but tsup bundles this into a flat
 * `dist/cli.js`, one directory below the root, at build time. Bounded to a
 * handful of levels, and checks the package name too, so this can't walk
 * out of the package entirely or pick up an unrelated package.json.
 */
export function getPackageVersion(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl))
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as {name?: string; version?: string}
      if (pkg.name === 'unicode-shield' && typeof pkg.version === 'string') return pkg.version
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return 'unknown'
}
