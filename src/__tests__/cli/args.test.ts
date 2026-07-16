import {describe, expect, it} from 'vitest'

import {flagAsBoolean, flagAsString, parseArgs} from '../../cli/args'

describe('parseArgs', () => {
  it('collects bare positional arguments', () => {
    expect(parseArgs(['a', 'b', 'c']).positionals).toEqual(['a', 'b', 'c'])
  })

  it('parses a boolean flag with no value', () => {
    expect(parseArgs(['--json']).flags).toEqual({json: true})
  })

  it('parses a flag followed by a value', () => {
    expect(parseArgs(['--replacement', 'X']).flags).toEqual({replacement: 'X'})
  })

  it('parses a flag=value form', () => {
    expect(parseArgs(['--replacement=X']).flags).toEqual({replacement: 'X'})
  })

  it('does not consume the next flag as a value', () => {
    const result = parseArgs(['--write', '--json'])
    expect(result.flags).toEqual({write: true, json: true})
  })

  it('never lets a known boolean flag swallow a following positional as its value', () => {
    // A bare "second-positional" after --json is genuinely ambiguous
    // without knowing --json is boolean-only; booleanFlags resolves it.
    const result = parseArgs(['--json', 'second-positional'])
    expect(result.flags).toEqual({json: true})
    expect(result.positionals).toEqual(['second-positional'])
  })

  it('still lets a non-boolean flag consume the next value, even with the default boolean set', () => {
    const result = parseArgs(['--replacement', 'X', 'positional'])
    expect(result.flags).toEqual({replacement: 'X'})
    expect(result.positionals).toEqual(['positional'])
  })

  it('mixes positionals and flags in any order', () => {
    const result = parseArgs(['scan-target', '--json', 'second-positional'])
    expect(result.positionals).toEqual(['scan-target', 'second-positional'])
    expect(result.flags).toEqual({json: true})
  })

  it('treats everything after a literal -- as positional, even if it looks like a flag', () => {
    const result = parseArgs(['compare', 'apple', '--', '--orange'])
    expect(result.positionals).toEqual(['compare', 'apple', '--orange'])
    expect(result.flags).toEqual({})
  })

  it('returns empty results for no arguments', () => {
    expect(parseArgs([])).toEqual({positionals: [], flags: {}})
  })
})

describe('flagAsString', () => {
  it('returns the string value when present', () => {
    expect(flagAsString({replacement: 'X'}, 'replacement')).toBe('X')
  })

  it('returns undefined for a boolean flag', () => {
    expect(flagAsString({write: true}, 'write')).toBeUndefined()
  })

  it('returns undefined when the flag is absent', () => {
    expect(flagAsString({}, 'replacement')).toBeUndefined()
  })
})

describe('flagAsBoolean', () => {
  it('returns true for a bare boolean flag', () => {
    expect(flagAsBoolean({json: true}, 'json')).toBe(true)
  })

  it('returns false when the flag is absent', () => {
    expect(flagAsBoolean({}, 'json')).toBe(false)
  })

  it('returns false for a flag that has a string value instead', () => {
    expect(flagAsBoolean({json: 'yes'}, 'json')).toBe(false)
  })
})
