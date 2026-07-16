import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// See src/__tests__/cli/file-walk.test.ts for why this indirection (rather
// than vi.spyOn) is needed to simulate an unreadable directory: native ESM
// module namespace objects can't be redefined directly.
const unreadableDirTrigger = vi.hoisted(() => ({path: null as string | null}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readdirSync: (dir: Parameters<typeof actual.readdirSync>[0], options: Parameters<typeof actual.readdirSync>[1]) => {
      if (dir === unreadableDirTrigger.path) {
        throw new Error('EACCES: permission denied (simulated)')
      }
      return actual.readdirSync(dir, options)
    },
  }
})

const {parseArgs} = await import('../../../cli/args')
const {runScan} = await import('../../../cli/commands/scan')

const RLO = String.fromCodePoint(0x202e)

describe('runScan', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unicode-shield-cli-scan-test-'))
  })

  afterEach(() => {
    unreadableDirTrigger.path = null
    rmSync(root, {recursive: true, force: true})
  })

  it('exits 2 with usage text when no path is given', () => {
    const result = runScan(parseArgs([]))
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Usage')
  })

  it('exits 0 for a clean file', () => {
    const filePath = join(root, 'clean.txt')
    writeFileSync(filePath, 'hello world', 'utf8')
    const result = runScan(parseArgs([filePath]))
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('No threats found')
  })

  it('exits 1 and reports the threat for a file with a bidi override', () => {
    const filePath = join(root, 'bad.txt')
    writeFileSync(filePath, `admin${RLO}nimda`, 'utf8')
    const result = runScan(parseArgs([filePath]))
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('bidi-embedding')
  })

  it('produces valid, safe: false JSON with --json', () => {
    const filePath = join(root, 'bad.txt')
    writeFileSync(filePath, `admin${RLO}nimda`, 'utf8')
    const result = runScan(parseArgs([filePath, '--json']))
    const parsed = JSON.parse(result.output) as {safe: boolean}
    expect(parsed.safe).toBe(false)
  })

  it('exits 2 with a clear error for a nonexistent path', () => {
    const result = runScan(parseArgs([join(root, 'nope.txt')]))
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Error')
  })

  it('scans every file in a directory and aggregates results', () => {
    writeFileSync(join(root, 'clean.txt'), 'hello', 'utf8')
    writeFileSync(join(root, 'bad.txt'), `admin${RLO}nimda`, 'utf8')
    const result = runScan(parseArgs([root]))
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Found 1 threat in 1 file, 2 files scanned')
  })

  it('exits 1 and reports the path, not silently 0, when a subdirectory could not be read', () => {
    mkdirSync(join(root, 'locked'), {recursive: true})
    writeFileSync(join(root, 'clean.txt'), 'hello', 'utf8')
    writeFileSync(join(root, 'locked', 'hidden.txt'), 'hello', 'utf8')

    const lockedDir = join(root, 'locked')
    unreadableDirTrigger.path = lockedDir

    const result = runScan(parseArgs([root]))
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(lockedDir)
    expect(result.output).toContain('1 directory could not be read')
  })
})
