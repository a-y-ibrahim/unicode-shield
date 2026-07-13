import {describe, expect, it} from 'vitest'

import {areConfusable, getSkeleton} from '../../confusables/skeleton'

const CYRILLIC_A = String.fromCodePoint(0x0430) // CYRILLIC SMALL LETTER A, confusable with Latin a
const CYRILLIC_E = String.fromCodePoint(0x0435) // CYRILLIC SMALL LETTER IE, confusable with Latin e
const CYRILLIC_O = String.fromCodePoint(0x043e) // CYRILLIC SMALL LETTER O, confusable with Latin o
const GREEK_OMICRON = String.fromCodePoint(0x03bf) // GREEK SMALL LETTER OMICRON, confusable with Latin o
const FULLWIDTH_QUOTE = String.fromCodePoint(0xff02) // FULLWIDTH QUOTATION MARK

describe('getSkeleton', () => {
  it('throws a clear TypeError for non-string input', () => {
    // @ts-expect-error intentionally wrong type, mirrors a JS-only caller.
    expect(() => getSkeleton(undefined)).toThrow(TypeError)
    // @ts-expect-error see above
    expect(() => getSkeleton(undefined)).toThrow(/expects a string/)
  })

  it('leaves an ordinary ASCII string unchanged', () => {
    expect(getSkeleton('hello world')).toBe('hello world')
  })

  it('is deterministic and does not falsely equate unrelated Arabic and Latin text', () => {
    // Individual Arabic letters can legitimately participate in a
    // confusable relationship (Unicode's own data maps ARABIC LETTER ALEF
    // to LATIN SMALL LETTER L, both being a simple vertical stroke), so a
    // skeleton is not a byte-for-byte no-op on arbitrary Arabic text. What
    // must hold is that it's stable and doesn't collapse genuinely
    // different words together.
    expect(getSkeleton('مرحبا بالعالم')).toBe(getSkeleton('مرحبا بالعالم'))
    expect(areConfusable('مرحبا', 'hello')).toBe(false)
  })

  it('maps a single confusable character to its Latin prototype', () => {
    expect(getSkeleton(CYRILLIC_A)).toBe('a')
    expect(getSkeleton(CYRILLIC_E)).toBe('e')
    expect(getSkeleton(CYRILLIC_O)).toBe('o')
    expect(getSkeleton(GREEK_OMICRON)).toBe('o')
  })

  it('maps a source character to a multi-code-point target when that is what Unicode defines', () => {
    // U+FF02 FULLWIDTH QUOTATION MARK is itself a confusables.txt source,
    // mapped straight to two apostrophes (U+0027 U+0027), not via NFD.
    expect(getSkeleton(FULLWIDTH_QUOTE)).toBe("''")
  })

  it('is idempotent: skeletons never need a second pass', () => {
    const input = `${CYRILLIC_A}pple`
    const once = getSkeleton(input)
    expect(getSkeleton(once)).toBe(once)
  })

  it('handles an empty string', () => {
    expect(getSkeleton('')).toBe('')
  })

  it('does not fold letter case: case is not a confusable-character concern', () => {
    expect(getSkeleton('Apple')).not.toBe(getSkeleton('apple'))
  })
})

describe('areConfusable', () => {
  it('throws a clear TypeError for non-string input', () => {
    // @ts-expect-error intentionally wrong type, mirrors a JS-only caller.
    expect(() => areConfusable(undefined, 'a')).toThrow(TypeError)
    // @ts-expect-error see above
    expect(() => areConfusable('a', undefined)).toThrow(/expects two strings/)
  })

  it('flags the exact class of bug this library exists for: a lookalike username', () => {
    const realUsername = 'apple'
    const spoofedUsername = `${CYRILLIC_A}pple`
    expect(realUsername).not.toBe(spoofedUsername) // different strings...
    expect(areConfusable(realUsername, spoofedUsername)).toBe(true) // ...but confusable
  })

  it('is true for identical strings', () => {
    expect(areConfusable('apple', 'apple')).toBe(true)
  })

  it('is false for genuinely different strings', () => {
    expect(areConfusable('apple', 'orange')).toBe(false)
  })

  it('is false for strings that only differ in case', () => {
    expect(areConfusable('Apple', 'apple')).toBe(false)
  })

  it('is symmetric', () => {
    const a = 'apple'
    const b = `${CYRILLIC_A}pple`
    expect(areConfusable(a, b)).toBe(areConfusable(b, a))
  })

  it('treats two different confusable spellings of the same word as confusable with each other', () => {
    const allCyrillicLookalikes = `${CYRILLIC_A}${CYRILLIC_O}${CYRILLIC_E}`
    const allLatin = 'aoe'
    expect(areConfusable(allCyrillicLookalikes, allLatin)).toBe(true)
  })
})
