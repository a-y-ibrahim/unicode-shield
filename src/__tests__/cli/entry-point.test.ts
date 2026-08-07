import {execFileSync} from 'node:child_process'
import {existsSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {beforeAll, describe, expect, it} from 'vitest'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const distCli = join(projectRoot, 'dist', 'cli.js')

/**
 * npm installs a package's `bin` entry (package.json's `bin` field) as a
 * symlink on Linux/macOS: node_modules/.bin/unicode-shield ->
 * ../unicode-shield/dist/cli.js. That's exactly the shape `npx
 * unicode-shield@version ...` invokes at runtime, and it's a genuinely
 * different code path from running dist/cli.js directly: Node's ESM loader
 * resolves import.meta.url through the symlink to the real file, but
 * process.argv[1] stays whatever path was actually invoked (the symlink).
 * cli/index.ts's own isMain check has to account for that, see its
 * comment there. No unit test of run() (see index.test.ts) can exercise
 * this: vitest itself imports that module directly, so process.argv[1] is
 * already vitest's own entry point in every unit test, never this file,
 * regardless of whether the real bug is present or fixed.
 *
 * This repo's own CI only runs this suite on ubuntu-latest (see
 * .github/workflows/ci.yml's comment on why pnpm 11 needs that), which is
 * also exactly the platform this needs real coverage on. Windows uses a
 * .cmd shim for bin entries instead of a symlink, so this specific
 * regression has no Windows equivalent to test there, skipped rather than
 * attempted with a fake symlink: confirmed directly on this machine that
 * fs.symlinkSync throws without Administrator/Developer Mode, and that
 * Git Bash's own `ln -s` silently falls back to a plain copy instead
 * (fs.lstatSync on the result reports isSymbolicLink() === false), which
 * would make a Windows version of this test pass unconditionally whether
 * the real fix is present or not.
 */
describe.skipIf(process.platform === 'win32')(
  'cli entry point, invoked through a symlink (matches how npm/npx actually run it)',
  () => {
    beforeAll(() => {
      if (!existsSync(distCli)) {
        execFileSync(join(projectRoot, 'node_modules', '.bin', 'tsup'), [], {cwd: projectRoot, stdio: 'inherit'})
      }
    }, 60_000)

    it('still runs and produces real output through a symlink, not just its own real path', () => {
      const dir = mkdtempSync(join(tmpdir(), 'unicode-shield-entry-point-'))
      try {
        const linkPath = join(dir, 'unicode-shield')
        symlinkSync(distCli, linkPath)

        const output = execFileSync('node', [linkPath, '--version'], {encoding: 'utf8'})

        // Fails on the pre-fix isMain check: isMain evaluates to false
        // through the symlink mismatch described above, so nothing in
        // index.ts ever runs, and this would be an empty string instead
        // of a real version, exit code 0 either way.
        expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/)
      } finally {
        rmSync(dir, {recursive: true, force: true})
      }
    })
  },
)
