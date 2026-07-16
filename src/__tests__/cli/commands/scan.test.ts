import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {parseArgs} from '../../../cli/args'
import {runScan} from '../../../cli/commands/scan'

const RLO = String.fromCodePoint(0x202e)

describe('runScan', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unicode-shield-cli-scan-test-'))
  })

  afterEach(() => {
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
})
