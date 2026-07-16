import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {isDirectory, readTextFile, resolveFiles} from '../../cli/file-walk'

describe('resolveFiles / isDirectory / readTextFile', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unicode-shield-cli-test-'))
  })

  afterEach(() => {
    rmSync(root, {recursive: true, force: true})
  })

  it('resolves a single file to itself', () => {
    const filePath = join(root, 'a.txt')
    writeFileSync(filePath, 'hello', 'utf8')
    expect(resolveFiles(filePath)).toEqual([filePath])
    expect(isDirectory(filePath)).toBe(false)
  })

  it('recurses into subdirectories', () => {
    mkdirSync(join(root, 'sub'), {recursive: true})
    writeFileSync(join(root, 'top.txt'), 'a', 'utf8')
    writeFileSync(join(root, 'sub', 'nested.txt'), 'b', 'utf8')

    const found = resolveFiles(root).sort()
    expect(found).toEqual([join(root, 'sub', 'nested.txt'), join(root, 'top.txt')].sort())
    expect(isDirectory(root)).toBe(true)
  })

  it('skips common non-source directories', () => {
    mkdirSync(join(root, 'node_modules'), {recursive: true})
    mkdirSync(join(root, '.git'), {recursive: true})
    writeFileSync(join(root, 'node_modules', 'dep.txt'), 'x', 'utf8')
    writeFileSync(join(root, '.git', 'HEAD'), 'x', 'utf8')
    writeFileSync(join(root, 'real.txt'), 'x', 'utf8')

    expect(resolveFiles(root)).toEqual([join(root, 'real.txt')])
  })

  it('skips files with a binary-looking extension', () => {
    writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50]))
    writeFileSync(join(root, 'archive.zip'), Buffer.from([0x50, 0x4b]))
    writeFileSync(join(root, 'real.txt'), 'x', 'utf8')

    expect(resolveFiles(root)).toEqual([join(root, 'real.txt')])
  })

  it('does not skip an unfamiliar text extension, a denylist not an allowlist', () => {
    writeFileSync(join(root, 'data.weird-extension'), 'x', 'utf8')
    expect(resolveFiles(root)).toEqual([join(root, 'data.weird-extension')])
  })

  it('reads a file back as utf8 text', () => {
    const filePath = join(root, 'a.txt')
    writeFileSync(filePath, 'مرحبا', 'utf8')
    expect(readTextFile(filePath)).toBe('مرحبا')
  })
})
