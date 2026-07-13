import {describe, expect, it} from 'vitest'

import {sanitize} from '../sanitize'
import {scan} from '../scan'

const RLO = String.fromCodePoint(0x202e)
const LRM = String.fromCodePoint(0x200e)
const RLM = String.fromCodePoint(0x200f)
const ALM = String.fromCodePoint(0x061c)
const ZWSP = String.fromCodePoint(0x200b)
const BOM = String.fromCodePoint(0xfeff)
const ZWJ = String.fromCodePoint(0x200d)
const INVISIBLE_TIMES = String.fromCodePoint(0x2062)

describe('sanitize', () => {
  it('throws a clear TypeError for non-string input', () => {
    // @ts-expect-error intentionally wrong type, mirrors a JS-only caller.
    expect(() => sanitize(undefined)).toThrow(TypeError)
    // @ts-expect-error see above
    expect(() => sanitize(null)).toThrow(/expects a string/)
  })

  it('returns a clean string unchanged', () => {
    expect(sanitize('hello world')).toBe('hello world')
    expect(sanitize('مرحبا بالعالم')).toBe('مرحبا بالعالم')
  })

  it('strips a bidi override so the spoofed suffix cannot hide (the Bluesky bug class)', () => {
    // Without sanitizing, copying a display name containing a bidi override
    // character from a UI can paste as "admin" followed by an invisible
    // reversal of "nimda", exactly the class of bug fixed in
    // bluesky-social/social-app#11066.
    const result = sanitize(`admin${RLO}nimda`)
    expect(result).toBe('adminnimda')
    expect(scan(result).safe).toBe(true)
  })

  it('strips zero-width padding characters', () => {
    expect(sanitize(`admin${ZWSP}${ZWSP}${ZWSP}`)).toBe('admin')
  })

  it('strips invisible math-operator padding characters', () => {
    expect(sanitize(`admin${INVISIBLE_TIMES}${INVISIBLE_TIMES}`)).toBe('admin')
  })

  it('strips a stray byte-order mark', () => {
    expect(sanitize(`hello${BOM}world`)).toBe('helloworld')
  })

  it('strips Unicode Tag characters used for invisible prompt injection', () => {
    const result = sanitize('looks empty\u{E0041}\u{E0042}')
    expect(result).toBe('looks empty')
  })

  it('strips Variation Selectors Supplement steganography payloads', () => {
    const vs1 = String.fromCodePoint(0xe0100)
    const vs2 = String.fromCodePoint(0xe0101)
    const result = sanitize(`hello${vs1}${vs2}world`)
    expect(result).toBe('helloworld')
    expect(scan(result).safe).toBe(true)
  })

  it('never strips ordinary emoji-presentation variation selectors', () => {
    const heart = '\u{2764}'
    const vs16 = String.fromCodePoint(0xfe0f)
    const input = `${heart}${vs16}`
    expect(sanitize(input)).toBe(input)
  })

  it('never strips legitimate bidi marks by default', () => {
    const input = `price: 100${LRM}${RLM} ريال${ALM}`
    expect(sanitize(input)).toBe(input)
  })

  it('never strips ZWJ emoji sequences by default', () => {
    const familyEmoji = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}${ZWJ}\u{1F466}`
    expect(sanitize(familyEmoji)).toBe(familyEmoji)
  })

  it('substitutes a custom replacement string instead of deleting', () => {
    expect(sanitize(`a${RLO}b`, {replacement: '[!]'})).toBe('a[!]b')
  })

  it('can be told to also strip informational categories explicitly', () => {
    const input = `a${LRM}b`
    expect(sanitize(input)).toBe(input)
    expect(sanitize(input, {categories: ['bidi-mark']})).toBe('ab')
  })

  it('strips multiple mixed threats in one pass, left to right', () => {
    const input = `a${RLO}b${ZWSP}c${BOM}d`
    const result = sanitize(input)
    expect(result).toBe('abcd')
    expect(scan(result).safe).toBe(true)
  })

  it('is idempotent, sanitizing an already-safe string is a no-op', () => {
    const once = sanitize(`a${RLO}b${ZWSP}c`)
    const twice = sanitize(once)
    expect(twice).toBe(once)
  })

  it('caps a Zalgo-style pile of combining marks at the threshold instead of stripping all of them', () => {
    const acute = String.fromCodePoint(0x0301)
    const result = sanitize(`e${acute.repeat(20)}`)
    expect([...result]).toHaveLength(1 + 6)
    expect(scan(result).safe).toBe(true)
  })

  it('never strips a reasonable number of combining marks on real text', () => {
    // Arabic tashkeel marks built from code points rather than typed as
    // literal diacritics in source, see the same pattern in scan.test.ts.
    const fatha = String.fromCodePoint(0x064e)
    const shadda = String.fromCodePoint(0x0651)
    const sukun = String.fromCodePoint(0x0652)
    const daggerAlif = String.fromCodePoint(0x0670)
    const kasra = String.fromCodePoint(0x0650)
    const arabic = `الر${shadda}${fatha}ح${sukun}م${fatha}${daggerAlif}ن${kasra}`
    const hebrew = 'שָׁלוֹם'
    expect(sanitize(arabic)).toBe(arabic)
    expect(sanitize(hebrew)).toBe(hebrew)
  })
})
