export interface LineColumn {
  line: number
  column: number
}

/**
 * Every newline's index in `text`, ascending. Computed once per file so
 * indexToLineColumn() can binary-search instead of re-scanning from the
 * start for every threat, which matters once a file has many.
 */
export function buildLineIndex(text: string): number[] {
  const newlineIndices: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') newlineIndices.push(i)
  }
  return newlineIndices
}

/**
 * Converts a UTF-16 code unit index (scan()'s Threat.index already is one,
 * see scan.ts) into a 1-based line and column, the convention editors and
 * most linters use.
 */
export function indexToLineColumn(newlineIndices: number[], index: number): LineColumn {
  let lo = 0
  let hi = newlineIndices.length - 1
  let line = 1
  let lastNewlineIndex = -1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const newlineIndex = newlineIndices[mid]!
    if (newlineIndex < index) {
      line = mid + 2
      lastNewlineIndex = newlineIndex
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  return {line, column: index - lastNewlineIndex}
}
