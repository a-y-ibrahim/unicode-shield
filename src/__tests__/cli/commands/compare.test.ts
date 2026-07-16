import {describe, expect, it} from 'vitest'

import {parseArgs} from '../../../cli/args'
import {runCompare} from '../../../cli/commands/compare'

describe('runCompare', () => {
  it('exits 2 with usage text when fewer than two positionals are given', () => {
    expect(runCompare(parseArgs([])).exitCode).toBe(2)
    expect(runCompare(parseArgs(['apple'])).exitCode).toBe(2)
    expect(runCompare(parseArgs([])).output).toContain('Usage')
  })

  it('exits 0 and reports not confusable for genuinely different strings', () => {
    const result = runCompare(parseArgs(['apple', 'orange']))
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('not visually confusable')
  })

  it('exits 1 and reports confusable for a Cyrillic homoglyph pair', () => {
    const cyrillicA = String.fromCodePoint(0x430)
    const result = runCompare(parseArgs(['apple', `${cyrillicA}pple`]))
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('are visually confusable')
  })

  it('produces JSON with the skeletons included when --json is passed', () => {
    const result = runCompare(parseArgs(['apple', 'orange', '--json']))
    const parsed = JSON.parse(result.output) as {confusable: boolean; skeletonA: string; skeletonB: string}
    expect(parsed.confusable).toBe(false)
    expect(typeof parsed.skeletonA).toBe('string')
    expect(typeof parsed.skeletonB).toBe('string')
  })

  it('treats a comparison value that itself starts with -- as a real string, not a flag, after a -- separator', () => {
    const result = runCompare(parseArgs(['apple', '--', '--weird-username']))
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('"apple" and "--weird-username"')
  })
})
