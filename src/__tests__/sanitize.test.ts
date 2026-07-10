import {describe, expect, it} from 'vitest'

import {sanitize} from '../sanitize'
import {scan} from '../scan'

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
    // Without sanitizing, copying "admin‮nimda" from a UI can paste as
    // "admin" followed by an invisible reversal of "nimda", exactly the
    // class of bug fixed in bluesky-social/social-app#11066.
    const result = sanitize('admin‮nimda')
    expect(result).toBe('adminnimda')
    expect(scan(result).safe).toBe(true)
  })

  it('strips zero-width padding characters', () => {
    expect(sanitize('admin​​​')).toBe('admin')
  })

  it('strips a stray byte-order mark', () => {
    expect(sanitize('hello﻿world')).toBe('helloworld')
  })

  it('strips Unicode Tag characters used for invisible prompt injection', () => {
    const result = sanitize('looks empty\u{E0041}\u{E0042}')
    expect(result).toBe('looks empty')
  })

  it('never strips legitimate bidi marks by default', () => {
    const input = 'price: 100‎‏ ريال؜'
    expect(sanitize(input)).toBe(input)
  })

  it('never strips ZWJ emoji sequences by default', () => {
    const familyEmoji = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    expect(sanitize(familyEmoji)).toBe(familyEmoji)
  })

  it('substitutes a custom replacement string instead of deleting', () => {
    expect(sanitize('a‮b', {replacement: '[!]'})).toBe('a[!]b')
  })

  it('can be told to also strip informational categories explicitly', () => {
    const input = 'a‎b'
    expect(sanitize(input)).toBe(input)
    expect(sanitize(input, {categories: ['bidi-mark']})).toBe('ab')
  })

  it('strips multiple mixed threats in one pass, left to right', () => {
    const input = 'a‮b​c﻿d'
    const result = sanitize(input)
    expect(result).toBe('abcd')
    expect(scan(result).safe).toBe(true)
  })

  it('is idempotent, sanitizing an already-safe string is a no-op', () => {
    const once = sanitize('a‮b​c')
    const twice = sanitize(once)
    expect(twice).toBe(once)
  })
})
