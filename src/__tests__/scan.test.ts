import {describe, expect, it} from 'vitest'

import {scan, isSafe} from '../scan'

const LRE = String.fromCodePoint(0x202a)
const RLE = String.fromCodePoint(0x202b)
const PDF = String.fromCodePoint(0x202c)
const LRO = String.fromCodePoint(0x202d)
const RLO = String.fromCodePoint(0x202e)
const LRI = String.fromCodePoint(0x2066)
const RLI = String.fromCodePoint(0x2067)
const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const LRM = String.fromCodePoint(0x200e)
const RLM = String.fromCodePoint(0x200f)
const ALM = String.fromCodePoint(0x061c)
const ZWSP = String.fromCodePoint(0x200b)
const BOM = String.fromCodePoint(0xfeff)
const ZWJ = String.fromCodePoint(0x200d)
const INVISIBLE_TIMES = String.fromCodePoint(0x2062)

describe('scan', () => {
  it('throws a clear TypeError for non-string input instead of an obscure crash', () => {
    // @ts-expect-error intentionally wrong types, this is what a JS-only
    // (non-TypeScript) caller could pass at runtime.
    expect(() => scan(undefined)).toThrow(TypeError)
    // @ts-expect-error see above
    expect(() => scan(undefined)).toThrow(/expects a string/)
    // @ts-expect-error see above
    expect(() => scan(null)).toThrow(TypeError)
    // @ts-expect-error see above
    expect(() => scan(123)).toThrow(TypeError)
    // @ts-expect-error see above
    expect(() => scan({})).toThrow(TypeError)
    // @ts-expect-error arrays are iterable in JS, so this must be checked
    // explicitly rather than relying on the for-of loop to reject it.
    expect(() => scan([])).toThrow(TypeError)
  })

  it('reports a clean ASCII string as safe with no threats', () => {
    const result = scan('hello world')
    expect(result.safe).toBe(true)
    expect(result.threats).toEqual([])
  })

  it('reports a clean Arabic string as safe with no threats', () => {
    const result = scan('مرحبا بالعالم')
    expect(result.safe).toBe(true)
    expect(result.threats).toEqual([])
  })

  it('flags a bidi override character as dangerous (the Trojan Source class)', () => {
    // The exact character class from CVE-2021-42574 and bluesky-social/social-app#11066.
    const input = `admin${RLO}nimda`
    const result = scan(input)
    expect(result.safe).toBe(false)
    expect(result.threats).toHaveLength(1)
    expect(result.threats[0]).toMatchObject({
      category: 'bidi-embedding',
      severity: 'dangerous',
      codePoint: 0x202e,
      index: 5,
    })
  })

  it('flags every bidi embedding and override character', () => {
    const chars = [LRE, RLE, PDF, LRO, RLO]
    for (const char of chars) {
      const result = scan(`a${char}b`)
      expect(result.safe).toBe(false)
      expect(result.threats[0]!.category).toBe('bidi-embedding')
    }
  })

  it('flags bidi isolates as dangerous', () => {
    const chars = [LRI, RLI, FSI, PDI]
    for (const char of chars) {
      const result = scan(`a${char}b`)
      expect(result.safe).toBe(false)
      expect(result.threats[0]!.category).toBe('bidi-isolate')
    }
  })

  it('flags zero-width spaces used to pad or spoof a string', () => {
    const result = scan(`admin${ZWSP}${ZWSP}${ZWSP}`)
    expect(result.safe).toBe(false)
    expect(result.threats).toHaveLength(3)
    expect(result.threats.every(t => t.category === 'invisible')).toBe(true)
  })

  it('flags invisible math-operator characters from the same block as WORD JOINER', () => {
    // U+2061-U+2064 (FUNCTION APPLICATION, INVISIBLE TIMES, INVISIBLE
    // SEPARATOR, INVISIBLE PLUS) are zero-width Format(Cf) characters right
    // next to WORD JOINER (U+2060) in General Punctuation, usable for the
    // same identity-padding trick as ZWSP.
    const result = scan(`admin${INVISIBLE_TIMES}${INVISIBLE_TIMES}`)
    expect(result.safe).toBe(false)
    expect(result.threats).toHaveLength(2)
    expect(result.threats.every(t => t.category === 'invisible')).toBe(true)
  })

  it('flags a stray byte-order mark in the middle of a string', () => {
    const result = scan(`hello${BOM}world`)
    expect(result.safe).toBe(false)
    expect(result.threats[0]!.category).toBe('invisible')
  })

  it('flags Unicode Tag characters used for invisible prompt injection', () => {
    // U+E0041 = TAG LATIN CAPITAL LETTER A, part of the deprecated Tags
    // block repurposed since 2024 for invisible "ASCII smuggling" payloads
    // aimed at LLMs. This is a supplementary-plane character (a UTF-16
    // surrogate pair), which is exactly why scan() iterates by code point.
    const input = 'looks empty\u{E0041}\u{E0042}'
    const result = scan(input)
    expect(result.safe).toBe(false)
    const tagThreats = result.threats.filter(t => t.category === 'tag')
    expect(tagThreats).toHaveLength(2)
    expect(tagThreats[0]!.codePoint).toBe(0xe0041)
  })

  it('flags Variation Selectors Supplement characters used for steganography', () => {
    // U+E0100.. is documented since 2024 as a "variation selector smuggling"
    // technique: stacking many of these after a base character encodes an
    // arbitrary invisible byte payload, the same class of attack as the
    // Tags block, different code points. Also a supplementary-plane range.
    const vs1 = String.fromCodePoint(0xe0100)
    const vs2 = String.fromCodePoint(0xe0101)
    const input = `hello${vs1}${vs2}world`
    const result = scan(input)
    expect(result.safe).toBe(false)
    const vsThreats = result.threats.filter(t => t.category === 'variation-selector')
    expect(vsThreats).toHaveLength(2)
    expect(vsThreats[0]!.codePoint).toBe(0xe0100)
  })

  it('does not flag ordinary emoji-presentation variation selectors as dangerous', () => {
    // VS16 (U+FE0F) is how "text-style vs emoji-style" is chosen for
    // thousands of ordinary characters, for example after a heart symbol
    // to render it as an emoji. Only the Supplement block above is flagged.
    const heart = '\u{2764}'
    const vs16 = String.fromCodePoint(0xfe0f)
    const result = scan(`${heart}${vs16}`)
    expect(result.safe).toBe(true)
    expect(result.threats).toEqual([])
  })

  it('does not flag legitimate bidi marks as dangerous', () => {
    // LRM/RLM/ALM are single-character direction hints that real
    // multilingual text legitimately contains, for example around a
    // neutral punctuation mark next to Arabic or Hebrew text.
    const result = scan(`price: 100${LRM}${RLM} ريال${ALM}`)
    expect(result.safe).toBe(true)
    const marks = result.threats.filter(t => t.category === 'bidi-mark')
    expect(marks).toHaveLength(3)
    expect(marks.every(t => t.severity === 'informational')).toBe(true)
  })

  it('does not flag ZWJ/ZWNJ as dangerous (emoji and Persian/Indic text depend on them)', () => {
    // Family emoji built from four person emoji joined with ZWJ (U+200D).
    const familyEmoji = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}${ZWJ}\u{1F466}`
    const result = scan(familyEmoji)
    expect(result.safe).toBe(true)
    const joiners = result.threats.filter(t => t.category === 'joiner')
    expect(joiners).toHaveLength(3)
    expect(joiners.every(t => t.severity === 'informational')).toBe(true)
  })

  it('reports correct UTF-16 indices for use with String.slice', () => {
    const input = `ab${RLO}cd`
    const result = scan(input)
    expect(result.threats[0]!.index).toBe(2)
    expect(input.slice(0, 2)).toBe('ab')
    expect(input.slice(3)).toBe('cd')
  })

  it('handles a mix of dangerous and informational characters in one string', () => {
    const input = `ok${LRM}${RLO}bad`
    const result = scan(input)
    expect(result.safe).toBe(false)
    expect(result.threats).toHaveLength(2)
    expect(result.threats[0]!.category).toBe('bidi-mark')
    expect(result.threats[1]!.category).toBe('bidi-embedding')
  })
})

describe('isSafe', () => {
  it('mirrors scan().safe', () => {
    expect(isSafe('hello')).toBe(true)
    expect(isSafe(`a${RLO}b`)).toBe(false)
    expect(isSafe(`price${LRM}`)).toBe(true)
  })
})

describe('combining marks (Zalgo text)', () => {
  const ACUTE = String.fromCodePoint(0x0301) // COMBINING ACUTE ACCENT, General_Category Mn
  const VS_SUPPLEMENT = String.fromCodePoint(0xe0100)
  // Arabic tashkeel marks, built from code points rather than typed as
  // literal diacritics in source (project convention for hard-to-review
  // Unicode content, see the existing bidi/invisible test constants above).
  const FATHA = String.fromCodePoint(0x064e)
  const SHADDA = String.fromCodePoint(0x0651)
  const SUKUN = String.fromCodePoint(0x0652)
  const DAGGER_ALIF = String.fromCodePoint(0x0670)
  const KASRA = String.fromCodePoint(0x0650)
  // "ar-Rahman" fully voweled: alif-lam-ra + shadda+fatha, ha + sukun,
  // mim + fatha+dagger-alif, nun + kasra.
  const denselyVoweledArabic = `الر${SHADDA}${FATHA}ح${SUKUN}م${FATHA}${DAGGER_ALIF}ن${KASRA}`

  it('allows up to the threshold of stacked marks on one base character', () => {
    const result = scan(`e${ACUTE.repeat(6)}`)
    expect(result.safe).toBe(true)
    expect(result.threats.filter(t => t.category === 'combining-marks')).toHaveLength(0)
  })

  it('flags marks past the threshold, one threat per excess mark', () => {
    const result = scan(`e${ACUTE.repeat(7)}`)
    expect(result.safe).toBe(false)
    const flagged = result.threats.filter(t => t.category === 'combining-marks')
    expect(flagged).toHaveLength(1)
    expect(flagged[0]).toMatchObject({severity: 'dangerous', codePoint: 0x301})
  })

  it('flags a Zalgo-style pile of marks proportional to how far over the threshold it is', () => {
    const result = scan(`e${ACUTE.repeat(20)}`)
    expect(result.safe).toBe(false)
    expect(result.threats.filter(t => t.category === 'combining-marks')).toHaveLength(14)
  })

  it('resets the count per base character, not for the whole string', () => {
    // Two separate letters each with 6 marks (at the limit): neither run
    // individually exceeds the threshold, so nothing is flagged, even
    // though the string has 12 combining marks in total.
    const result = scan(`e${ACUTE.repeat(6)}o${ACUTE.repeat(6)}`)
    expect(result.safe).toBe(true)
  })

  it('does not flag real, densely voweled Arabic text', () => {
    // The densest realistic Quranic-annotation style Arabic gets: at most
    // 2-3 combining marks per letter, nowhere near the threshold of 6.
    const result = scan(denselyVoweledArabic)
    expect(result.safe).toBe(true)
    expect(result.threats.filter(t => t.category === 'combining-marks')).toHaveLength(0)
  })

  it('does not flag real Hebrew text with niqqud', () => {
    const result = scan('שָׁלוֹם') // "shalom" with vowel points
    expect(result.safe).toBe(true)
    expect(result.threats.filter(t => t.category === 'combining-marks')).toHaveLength(0)
  })

  it('does not flag real Vietnamese text decomposed into base letter plus combining diacritics', () => {
    const result = scan('Tiếng Việt'.normalize('NFD'))
    expect(result.safe).toBe(true)
    expect(result.threats.filter(t => t.category === 'combining-marks')).toHaveLength(0)
  })

  it('does not double-count Variation Selectors Supplement characters, they are Mn too but already have their own category', () => {
    const result = scan(`e${VS_SUPPLEMENT.repeat(10)}`)
    expect(result.threats.every(t => t.category === 'variation-selector')).toBe(true)
    expect(result.threats.filter(t => t.category === 'combining-marks')).toHaveLength(0)
  })

  it('does not merge two separate combining-mark runs across an unrelated classified character', () => {
    // 3 marks, then 5 variation selectors (a different, already-handled
    // category), then 3 more marks: two runs of 3 each, neither exceeds
    // the threshold of 6 on its own.
    const input = `e${ACUTE.repeat(3)}${VS_SUPPLEMENT.repeat(5)}${ACUTE.repeat(3)}`
    const result = scan(input)
    expect(result.threats.filter(t => t.category === 'combining-marks')).toHaveLength(0)
  })
})
