import {describe, expect, it} from 'vitest'

import {formatScanSarif} from '../../cli/sarif'
import type {FileScanResult} from '../../cli/format'

const dangerousThreat: FileScanResult['threats'][number] = {
  category: 'bidi-embedding',
  severity: 'dangerous',
  char: '‮',
  codePoint: 0x202e,
  index: 5,
  name: 'RIGHT-TO-LEFT OVERRIDE',
  line: 1,
  column: 6,
}

const informationalThreat: FileScanResult['threats'][number] = {
  category: 'bidi-mark',
  severity: 'informational',
  char: '‎',
  codePoint: 0x200e,
  index: 2,
  name: 'LEFT-TO-RIGHT MARK',
  line: 1,
  column: 3,
}

const cleanFile: FileScanResult = {path: 'clean.txt', safe: true, threats: []}
const threatFile: FileScanResult = {path: 'bad.txt', safe: false, threats: [dangerousThreat]}
const errorFile: FileScanResult = {path: 'locked.txt', safe: true, threats: [], error: 'EACCES'}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(output: string): any {
  return JSON.parse(output)
}

describe('formatScanSarif', () => {
  it('produces valid, parseable JSON', () => {
    expect(() => JSON.parse(formatScanSarif([threatFile], [], '1.2.3'))).not.toThrow()
  })

  it('declares the SARIF 2.1.0 schema and version', () => {
    const log = parse(formatScanSarif([cleanFile], [], '1.2.3'))
    expect(log.version).toBe('2.1.0')
    expect(log.$schema).toContain('sarif-schema-2.1.0.json')
  })

  it('embeds the tool name and passed-in version', () => {
    const log = parse(formatScanSarif([cleanFile], [], '1.2.3'))
    expect(log.runs[0].tool.driver.name).toBe('unicode-shield')
    expect(log.runs[0].tool.driver.version).toBe('1.2.3')
  })

  it('declares a rule for every threat category plus the two coverage-gap rules', () => {
    const log = parse(formatScanSarif([cleanFile], [], '1.2.3'))
    const ruleIds = log.runs[0].tool.driver.rules.map((rule: {id: string}) => rule.id)
    expect(ruleIds).toEqual(
      expect.arrayContaining([
        'bidi-embedding',
        'bidi-isolate',
        'invisible',
        'tag',
        'variation-selector',
        'combining-marks',
        'bidi-mark',
        'joiner',
        'unreadable-file',
        'unreadable-directory',
      ]),
    )
    expect(ruleIds).toHaveLength(10)
  })

  it('produces zero results for a clean scan', () => {
    const log = parse(formatScanSarif([cleanFile], [], '1.2.3'))
    expect(log.runs[0].results).toEqual([])
  })

  it('emits a level: error result for a dangerous threat, with the right ruleId, file, and position', () => {
    const log = parse(formatScanSarif([threatFile], [], '1.2.3'))
    const [result] = log.runs[0].results
    expect(result.ruleId).toBe('bidi-embedding')
    expect(result.level).toBe('error')
    expect(result.message.text).toContain('RIGHT-TO-LEFT OVERRIDE')
    expect(result.message.text).toContain('U+202E')
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('bad.txt')
    expect(result.locations[0].physicalLocation.region).toEqual({startLine: 1, startColumn: 6})
  })

  it.each([
    ['invisible', 'an invisible character'] as const,
    ['combining-marks', 'an excessively stacked combining mark'] as const,
  ])('phrases the %s category as a single, grammatically correct noun phrase in the message', (category, expectedPhrase) => {
    const file: FileScanResult = {path: 'f.ts', safe: false, threats: [{...dangerousThreat, category}]}
    const log = parse(formatScanSarif([file], [], '1.2.3'))
    const [result] = log.runs[0].results
    expect(result.message.text).toContain(expectedPhrase)
    expect(result.message.text).not.toMatch(/\bcharacter character\b/)
  })

  it('emits a level: note result for an informational threat (bidi-mark)', () => {
    const file: FileScanResult = {path: 'ok.txt', safe: true, threats: [informationalThreat]}
    const log = parse(formatScanSarif([file], [], '1.2.3'))
    const [result] = log.runs[0].results
    expect(result.ruleId).toBe('bidi-mark')
    expect(result.level).toBe('note')
  })

  it('every ruleId used by a result actually exists among the declared rules', () => {
    const file: FileScanResult = {path: 'mixed.txt', safe: false, threats: [dangerousThreat, informationalThreat]}
    const log = parse(formatScanSarif([file], ['/locked-dir'], '1.2.3'))
    const declaredIds = new Set(log.runs[0].tool.driver.rules.map((rule: {id: string}) => rule.id))
    for (const result of log.runs[0].results) {
      expect(declaredIds.has(result.ruleId)).toBe(true)
    }
  })

  it('emits a level: warning result for a file that could not be read, without a region', () => {
    const log = parse(formatScanSarif([errorFile], [], '1.2.3'))
    const [result] = log.runs[0].results
    expect(result.ruleId).toBe('unreadable-file')
    expect(result.level).toBe('warning')
    expect(result.message.text).toContain('EACCES')
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('locked.txt')
    expect(result.locations[0].physicalLocation.region).toBeUndefined()
  })

  it('emits a level: warning result for an unreadable directory', () => {
    const log = parse(formatScanSarif([cleanFile], ['dist/locked'], '1.2.3'))
    const [result] = log.runs[0].results
    expect(result.ruleId).toBe('unreadable-directory')
    expect(result.level).toBe('warning')
    expect(result.message.text).toContain('dist/locked')
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('dist/locked')
  })

  it('normalizes a Windows-style backslash path to forward slashes in the artifact URI', () => {
    const file: FileScanResult = {path: 'src\\components\\App.tsx', safe: false, threats: [dangerousThreat]}
    const log = parse(formatScanSarif([file], [], '1.2.3'))
    const [result] = log.runs[0].results
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('src/components/App.tsx')
  })

  it('prefixes a drive-letter absolute path with a leading slash so it does not parse as a URI scheme', () => {
    const file: FileScanResult = {path: 'C:/repo/src/app.ts', safe: false, threats: [dangerousThreat]}
    const log = parse(formatScanSarif([file], [], '1.2.3'))
    const [result] = log.runs[0].results
    const uri = result.locations[0].physicalLocation.artifactLocation.uri
    expect(uri).toBe('/C:/repo/src/app.ts')
    // The actual regression this guards: without the leading slash, a real
    // URL parser reads "C:" as the scheme and silently drops the drive
    // letter from the path entirely, confirmed directly (see the comment
    // on toArtifactUri). Assert against that same real parser here, not
    // just the raw string, so this test would have caught the bug it's
    // named for.
    expect(new URL(uri, 'file:///').pathname).toBe('/C:/repo/src/app.ts')
  })

  it('omits locations entirely for a stdin-sourced result rather than inventing a fake path', () => {
    const file: FileScanResult = {path: '(stdin)', safe: false, threats: [dangerousThreat]}
    const log = parse(formatScanSarif([file], [], '1.2.3'))
    const [result] = log.runs[0].results
    expect(result.locations).toBeUndefined()
  })

  it('aggregates results across multiple files in the given order', () => {
    const log = parse(formatScanSarif([threatFile, cleanFile, errorFile], [], '1.2.3'))
    const ruleIds = log.runs[0].results.map((result: {ruleId: string}) => result.ruleId)
    expect(ruleIds).toEqual(['bidi-embedding', 'unreadable-file'])
  })
})
