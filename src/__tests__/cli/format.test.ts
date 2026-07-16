import {describe, expect, it} from 'vitest'

import {formatScanHuman, formatScanJson, type FileScanResult} from '../../cli/format'

const cleanFile: FileScanResult = {path: 'clean.txt', safe: true, threats: []}

const threatFile: FileScanResult = {
  path: 'bad.txt',
  safe: false,
  threats: [
    {
      category: 'bidi-embedding',
      severity: 'dangerous',
      char: '‮',
      codePoint: 0x202e,
      index: 5,
      name: 'RIGHT-TO-LEFT OVERRIDE',
      line: 1,
      column: 6,
    },
  ],
}

const errorFile: FileScanResult = {path: 'unreadable.txt', safe: true, threats: [], error: 'permission denied'}

describe('formatScanHuman', () => {
  it('reports a clean summary when nothing is found', () => {
    const output = formatScanHuman([cleanFile])
    expect(output).toContain('No threats found')
    expect(output).toContain('1 file scanned')
  })

  it('omits a clean file from the per-file listing', () => {
    const output = formatScanHuman([cleanFile])
    expect(output).not.toContain('clean.txt')
  })

  it('lists the file path, position, category, and name for a threat', () => {
    const output = formatScanHuman([threatFile])
    expect(output).toContain('bad.txt')
    expect(output).toContain('1:6')
    expect(output).toContain('bidi-embedding')
    expect(output).toContain('RIGHT-TO-LEFT OVERRIDE')
    expect(output).toContain('U+202E')
  })

  it('summarizes the total threat and file counts across multiple files', () => {
    const output = formatScanHuman([cleanFile, threatFile])
    expect(output).toContain('Found 1 threat in 1 file')
    expect(output).toContain('2 files scanned')
  })

  it('pluralizes correctly for multiple threats', () => {
    const twoThreats: FileScanResult = {...threatFile, threats: [threatFile.threats[0]!, threatFile.threats[0]!]}
    const output = formatScanHuman([twoThreats])
    expect(output).toContain('Found 2 threats in 1 file')
  })

  it('reports a file that could not be read as an error, not a false-clean result', () => {
    const output = formatScanHuman([errorFile])
    expect(output).toContain('unreadable.txt')
    expect(output).toContain('permission denied')
    expect(output).toContain('1 file could not be read')
  })
})

describe('formatScanJson', () => {
  it('reports safe: true when every file is clean', () => {
    const parsed = JSON.parse(formatScanJson([cleanFile])) as {safe: boolean}
    expect(parsed.safe).toBe(true)
  })

  it('reports safe: false when any file has a dangerous threat', () => {
    const parsed = JSON.parse(formatScanJson([cleanFile, threatFile])) as {safe: boolean}
    expect(parsed.safe).toBe(false)
  })

  it('reports safe: false when any file errored, an unreadable file is not silently clean', () => {
    const parsed = JSON.parse(formatScanJson([cleanFile, errorFile])) as {safe: boolean}
    expect(parsed.safe).toBe(false)
  })

  it('includes the full file list and per-threat detail', () => {
    const parsed = JSON.parse(formatScanJson([threatFile])) as {filesScanned: number; files: FileScanResult[]}
    expect(parsed.filesScanned).toBe(1)
    expect(parsed.files[0]!.threats[0]!.category).toBe('bidi-embedding')
  })
})
