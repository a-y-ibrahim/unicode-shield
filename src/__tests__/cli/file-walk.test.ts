import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// vi.mock factories are hoisted above imports, so state they close over
// can't be a plain outer-scope variable; vi.hoisted() is vitest's
// documented way to share it. null means "don't intercept, behave
// normally", set only for the one test that needs a simulated failure.
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

const {isDirectory, readTextFile, resolveFiles} = await import('../../cli/file-walk')

describe('resolveFiles / isDirectory / readTextFile', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unicode-shield-cli-test-'))
  })

  afterEach(() => {
    unreadableDirTrigger.path = null
    rmSync(root, {recursive: true, force: true})
  })

  it('resolves a single file to itself', () => {
    const filePath = join(root, 'a.txt')
    writeFileSync(filePath, 'hello', 'utf8')
    expect(resolveFiles(filePath)).toEqual({files: [filePath], unreadableDirectories: []})
    expect(isDirectory(filePath)).toBe(false)
  })

  it('recurses into subdirectories', () => {
    mkdirSync(join(root, 'sub'), {recursive: true})
    writeFileSync(join(root, 'top.txt'), 'a', 'utf8')
    writeFileSync(join(root, 'sub', 'nested.txt'), 'b', 'utf8')

    const {files, unreadableDirectories} = resolveFiles(root)
    expect(files.sort()).toEqual([join(root, 'sub', 'nested.txt'), join(root, 'top.txt')].sort())
    expect(unreadableDirectories).toEqual([])
    expect(isDirectory(root)).toBe(true)
  })

  it('skips common non-source directories', () => {
    mkdirSync(join(root, 'node_modules'), {recursive: true})
    mkdirSync(join(root, '.git'), {recursive: true})
    writeFileSync(join(root, 'node_modules', 'dep.txt'), 'x', 'utf8')
    writeFileSync(join(root, '.git', 'HEAD'), 'x', 'utf8')
    writeFileSync(join(root, 'real.txt'), 'x', 'utf8')

    expect(resolveFiles(root).files).toEqual([join(root, 'real.txt')])
  })

  it('skips files with a binary-looking extension', () => {
    writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50]))
    writeFileSync(join(root, 'archive.zip'), Buffer.from([0x50, 0x4b]))
    writeFileSync(join(root, 'real.txt'), 'x', 'utf8')

    expect(resolveFiles(root).files).toEqual([join(root, 'real.txt')])
  })

  it('does not skip an unfamiliar text extension, a denylist not an allowlist', () => {
    writeFileSync(join(root, 'data.weird-extension'), 'x', 'utf8')
    expect(resolveFiles(root).files).toEqual([join(root, 'data.weird-extension')])
  })

  it('reads a file back as utf8 text', () => {
    const filePath = join(root, 'a.txt')
    writeFileSync(filePath, 'مرحبا', 'utf8')
    expect(readTextFile(filePath)).toBe('مرحبا')
  })

  it('does not abort the whole walk when one subdirectory cannot be read, and reports it separately', () => {
    mkdirSync(join(root, 'good'), {recursive: true})
    mkdirSync(join(root, 'bad'), {recursive: true})
    writeFileSync(join(root, 'good', 'ok.txt'), 'x', 'utf8')
    writeFileSync(join(root, 'bad', 'unreachable.txt'), 'x', 'utf8')

    const badDir = join(root, 'bad')
    // Simulates a permission-denied (or mid-walk-removed) subdirectory
    // without depending on OS-specific chmod behavior, which wouldn't be
    // portable across this suite's Windows/Linux CI environments anyway.
    unreadableDirTrigger.path = badDir

    const {files, unreadableDirectories} = resolveFiles(root)
    expect(files).toEqual([join(root, 'good', 'ok.txt')])
    expect(unreadableDirectories).toEqual([badDir])
  })

  it('does not infinitely recurse through a directory symlink that loops back to an ancestor', () => {
    mkdirSync(join(root, 'sub'), {recursive: true})
    writeFileSync(join(root, 'sub', 'real.txt'), 'hello', 'utf8')

    try {
      symlinkSync(root, join(root, 'sub', 'loop'), 'junction')
    } catch {
      // Creating a symlink needs Developer Mode or admin rights on
      // Windows; skip rather than fail CI on a runner without either.
      return
    }

    const {files} = resolveFiles(root)
    expect(files).toContain(join(root, 'sub', 'real.txt'))
  })
})
