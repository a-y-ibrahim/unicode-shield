import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
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
const {runSanitize} = await import('../../../cli/commands/sanitize')

const RLO = String.fromCodePoint(0x202e)
const ZWSP = String.fromCodePoint(0x200b)

describe('runSanitize', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unicode-shield-cli-sanitize-test-'))
  })

  afterEach(() => {
    unreadableDirTrigger.path = null
    rmSync(root, {recursive: true, force: true})
  })

  it('exits 2 with usage text when no path is given', () => {
    const result = runSanitize(parseArgs([]))
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Usage')
  })

  it('prints sanitized content to stdout for a single file without --write, leaving the file untouched', () => {
    const filePath = join(root, 'bad.txt')
    writeFileSync(filePath, `admin${RLO}nimda`, 'utf8')
    const result = runSanitize(parseArgs([filePath]))
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('adminnimda')
    expect(readFileSync(filePath, 'utf8')).toBe(`admin${RLO}nimda`)
  })

  it('modifies the file in place with --write', () => {
    const filePath = join(root, 'bad.txt')
    writeFileSync(filePath, `admin${RLO}nimda`, 'utf8')
    const result = runSanitize(parseArgs([filePath, '--write']))
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('1 of 1 file modified')
    expect(readFileSync(filePath, 'utf8')).toBe('adminnimda')
  })

  it('reports 0 files modified when the file is already clean', () => {
    const filePath = join(root, 'clean.txt')
    writeFileSync(filePath, 'hello', 'utf8')
    const result = runSanitize(parseArgs([filePath, '--write']))
    expect(result.output).toContain('0 of 1 file modified')
  })

  it('rejects sanitizing a directory without --write', () => {
    writeFileSync(join(root, 'bad.txt'), `admin${RLO}nimda`, 'utf8')
    const result = runSanitize(parseArgs([root]))
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('--write')
  })

  it('modifies every file in a directory with --write', () => {
    writeFileSync(join(root, 'a.txt'), `x${RLO}y`, 'utf8')
    writeFileSync(join(root, 'b.txt'), 'clean', 'utf8')
    const result = runSanitize(parseArgs([root, '--write']))
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('1 of 2 files modified')
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('xy')
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('clean')
  })

  it('passes --replacement through to sanitize()', () => {
    const filePath = join(root, 'bad.txt')
    writeFileSync(filePath, `admin${RLO}nimda`, 'utf8')
    const result = runSanitize(parseArgs([filePath, '--replacement', '#']))
    expect(result.output).toBe('admin#nimda')
  })

  it('passes --categories through to sanitize() to strip an informational category too', () => {
    const filePath = join(root, 'marked.txt')
    const lrm = String.fromCodePoint(0x200e)
    writeFileSync(filePath, `price${lrm}`, 'utf8')
    // Without --categories, bidi-mark is informational and left alone.
    const untouched = runSanitize(parseArgs([filePath]))
    expect(untouched.output).toBe(`price${lrm}`)

    const stripped = runSanitize(parseArgs([filePath, '--categories', 'bidi-mark']))
    expect(stripped.output).toBe('price')
  })

  it('accepts a comma-separated --categories list with spaces around each name', () => {
    const filePath = join(root, 'marked.txt')
    const lrm = String.fromCodePoint(0x200e)
    const zwj = String.fromCodePoint(0x200d)
    writeFileSync(filePath, `price${lrm}${zwj}`, 'utf8')
    const result = runSanitize(parseArgs([filePath, '--categories', 'bidi-mark, joiner']))
    expect(result.output).toBe('price')
  })

  it('rejects an unrecognized --categories value instead of silently stripping nothing extra', () => {
    // The exact, realistic typo this exists to catch: the real category is
    // singular "bidi-mark", not plural.
    const filePath = join(root, 'x.txt')
    writeFileSync(filePath, 'hello', 'utf8')
    const result = runSanitize(parseArgs([filePath, '--categories', 'bidi-marks']))
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('bidi-marks')
    expect(result.output).toContain('bidi-mark')
  })

  it('lists every invalid name when --categories has more than one typo', () => {
    const filePath = join(root, 'x.txt')
    writeFileSync(filePath, 'hello', 'utf8')
    const result = runSanitize(parseArgs([filePath, '--categories', 'nope,alsonope']))
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('nope')
    expect(result.output).toContain('alsonope')
  })

  it('strips a zero-width space by default, confirming the invisible category is covered', () => {
    const filePath = join(root, 'zwsp.txt')
    writeFileSync(filePath, `admin${ZWSP}`, 'utf8')
    const result = runSanitize(parseArgs([filePath]))
    expect(result.output).toBe('admin')
  })

  it('reports an unreadable subdirectory as an error under --write, without losing the files it could reach', () => {
    mkdirSync(join(root, 'locked'), {recursive: true})
    writeFileSync(join(root, 'a.txt'), `x${RLO}y`, 'utf8')
    writeFileSync(join(root, 'locked', 'hidden.txt'), `x${RLO}y`, 'utf8')

    const lockedDir = join(root, 'locked')
    unreadableDirTrigger.path = lockedDir

    const result = runSanitize(parseArgs([root, '--write']))
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain(lockedDir)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('xy')
  })
})
