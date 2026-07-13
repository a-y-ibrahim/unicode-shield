import {describe, expect, it} from 'vitest'

import {detectMixedScript} from '../../confusables/mixed-script'

const CYRILLIC_A = String.fromCodePoint(0x0430) // CYRILLIC SMALL LETTER A
const GREEK_ALPHA = String.fromCodePoint(0x03b1) // GREEK SMALL LETTER ALPHA
const ARMENIAN_AYB = String.fromCodePoint(0x0561) // ARMENIAN SMALL LETTER AYB

describe('detectMixedScript', () => {
  it('throws a clear TypeError for non-string input', () => {
    // @ts-expect-error intentionally wrong type, mirrors a JS-only caller.
    expect(() => detectMixedScript(undefined)).toThrow(TypeError)
    // @ts-expect-error see above
    expect(() => detectMixedScript(undefined)).toThrow(/expects a string/)
  })

  it('reports no mixing for plain Latin text', () => {
    const result = detectMixedScript('apple')
    expect(result.mixed).toBe(false)
    expect(result.scripts).toEqual(['Latin'])
    expect(result.suspicious).toEqual([])
  })

  it('reports no mixing for plain Arabic text', () => {
    const result = detectMixedScript('مرحبا بالعالم')
    expect(result.mixed).toBe(false)
    expect(result.scripts).toEqual(['Arabic'])
  })

  it('does not count digits, spaces, or punctuation (Common script) as mixing', () => {
    const result = detectMixedScript('apple123 - v2.0!')
    expect(result.mixed).toBe(false)
    expect(result.scripts).toEqual(['Latin'])
  })

  it('flags the exact spoofing pattern this feature exists for: one substituted look-alike letter', () => {
    const input = `${CYRILLIC_A}pple`
    const result = detectMixedScript(input)
    expect(result.mixed).toBe(true)
    expect(result.scripts).toEqual(['Cyrillic', 'Latin'])
    expect(result.suspicious).toHaveLength(1)
    expect(result.suspicious[0]).toMatchObject({char: CYRILLIC_A, codePoint: 0x0430, index: 0, script: 'Cyrillic'})
  })

  it('treats the majority script as the base and flags only the minority characters', () => {
    // 4 Latin letters, 1 Cyrillic letter: Latin is the majority, so only
    // the Cyrillic one is "suspicious", not all five characters.
    const result = detectMixedScript(`appl${CYRILLIC_A}`)
    expect(result.suspicious).toHaveLength(1)
    expect(result.suspicious[0]!.script).toBe('Cyrillic')
  })

  it('reports every non-Common script present, not just two', () => {
    const input = `a${CYRILLIC_A}${GREEK_ALPHA}${ARMENIAN_AYB}`
    const result = detectMixedScript(input)
    expect(result.mixed).toBe(true)
    expect(result.scripts).toEqual(['Latin', 'Cyrillic', 'Greek', 'Armenian'])
  })

  it('reports correct UTF-16 indices for use with String.slice', () => {
    const input = `ab${CYRILLIC_A}cd`
    const result = detectMixedScript(input)
    expect(result.suspicious[0]!.index).toBe(2)
    expect(input.slice(2, 3)).toBe(CYRILLIC_A)
  })

  it('handles an empty string', () => {
    const result = detectMixedScript('')
    expect(result.mixed).toBe(false)
    expect(result.scripts).toEqual([])
    expect(result.suspicious).toEqual([])
  })

  it('does not flag emoji or symbols as a competing script', () => {
    const result = detectMixedScript('apple 🍎')
    expect(result.mixed).toBe(false)
  })
})
