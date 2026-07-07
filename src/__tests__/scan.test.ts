import {describe, expect, it} from 'vitest'

import {scan, isSafe} from '../scan'

describe('scan', () => {
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
    const input = 'admin‮nimda'
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
    const chars = ['‪', '‫', '‬', '‭', '‮']
    for (const char of chars) {
      const result = scan(`a${char}b`)
      expect(result.safe).toBe(false)
      expect(result.threats[0]!.category).toBe('bidi-embedding')
    }
  })

  it('flags bidi isolates as dangerous', () => {
    const chars = ['⁦', '⁧', '⁨', '⁩']
    for (const char of chars) {
      const result = scan(`a${char}b`)
      expect(result.safe).toBe(false)
      expect(result.threats[0]!.category).toBe('bidi-isolate')
    }
  })

  it('flags zero-width spaces used to pad or spoof a string', () => {
    const result = scan('admin​​​')
    expect(result.safe).toBe(false)
    expect(result.threats).toHaveLength(3)
    expect(result.threats.every(t => t.category === 'invisible')).toBe(true)
  })

  it('flags a stray byte-order mark in the middle of a string', () => {
    const result = scan('hello﻿world')
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

  it('does not flag legitimate bidi marks as dangerous', () => {
    // LRM/RLM/ALM are single-character direction hints that real
    // multilingual text legitimately contains, for example around a
    // neutral punctuation mark next to Arabic or Hebrew text.
    const result = scan('price: 100‎‏ ريال؜')
    expect(result.safe).toBe(true)
    const marks = result.threats.filter(t => t.category === 'bidi-mark')
    expect(marks).toHaveLength(3)
    expect(marks.every(t => t.severity === 'informational')).toBe(true)
  })

  it('does not flag ZWJ/ZWNJ as dangerous (emoji and Persian/Indic text depend on them)', () => {
    // Family emoji built from four person emoji joined with ZWJ (U+200D).
    const familyEmoji = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    const result = scan(familyEmoji)
    expect(result.safe).toBe(true)
    const joiners = result.threats.filter(t => t.category === 'joiner')
    expect(joiners).toHaveLength(3)
    expect(joiners.every(t => t.severity === 'informational')).toBe(true)
  })

  it('reports correct UTF-16 indices for use with String.slice', () => {
    const input = 'ab‮cd'
    const result = scan(input)
    expect(result.threats[0]!.index).toBe(2)
    expect(input.slice(0, 2)).toBe('ab')
    expect(input.slice(3)).toBe('cd')
  })

  it('handles a mix of dangerous and informational characters in one string', () => {
    const input = 'ok‎‮bad'
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
    expect(isSafe('a‮b')).toBe(false)
    expect(isSafe('price‎')).toBe(true)
  })
})
