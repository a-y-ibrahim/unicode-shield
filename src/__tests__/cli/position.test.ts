import {describe, expect, it} from 'vitest'

import {buildLineIndex, indexToLineColumn} from '../../cli/position'

describe('buildLineIndex + indexToLineColumn', () => {
  it('reports line 1, column 1 for the very first character', () => {
    const text = 'abc'
    expect(indexToLineColumn(buildLineIndex(text), 0)).toEqual({line: 1, column: 1})
  })

  it('reports the correct column partway through the first line', () => {
    const text = 'abcdef'
    expect(indexToLineColumn(buildLineIndex(text), 3)).toEqual({line: 1, column: 4})
  })

  it('advances to line 2 right after a newline', () => {
    const text = 'ab\ncd'
    const newlineIndices = buildLineIndex(text)
    // index 3 is 'c', the first character of line 2.
    expect(indexToLineColumn(newlineIndices, 3)).toEqual({line: 2, column: 1})
  })

  it('handles multiple lines, finding the correct one via binary search', () => {
    const text = 'a\nb\nc\nd\ne'
    const newlineIndices = buildLineIndex(text)
    // Character positions: a=0 \n=1 b=2 \n=3 c=4 \n=5 d=6 \n=7 e=8
    expect(indexToLineColumn(newlineIndices, 0)).toEqual({line: 1, column: 1})
    expect(indexToLineColumn(newlineIndices, 2)).toEqual({line: 2, column: 1})
    expect(indexToLineColumn(newlineIndices, 4)).toEqual({line: 3, column: 1})
    expect(indexToLineColumn(newlineIndices, 6)).toEqual({line: 4, column: 1})
    expect(indexToLineColumn(newlineIndices, 8)).toEqual({line: 5, column: 1})
  })

  it('handles a file with no newlines at all', () => {
    const text = 'no newlines here'
    expect(buildLineIndex(text)).toEqual([])
    expect(indexToLineColumn([], 5)).toEqual({line: 1, column: 6})
  })

  it('handles an index right at a line boundary consistently', () => {
    // A threat's own index should never land exactly on the newline
    // character in practice (scan() reports the threat character's own
    // position), but the function must still behave sensibly if it did.
    const text = 'ab\ncd'
    const newlineIndices = buildLineIndex(text)
    expect(indexToLineColumn(newlineIndices, 2)).toEqual({line: 1, column: 3})
  })
})
