import {classify, nameFor, severityOf} from './data/ranges'
import {type ScanResult, type Threat} from './types'

/**
 * Scans a string for bidi embedding/override characters, bidi isolates,
 * bidi marks, script joiners, invisible characters, and Unicode Tag
 * characters. Iterates by Unicode code point (not UTF-16 code unit) so
 * supplementary-plane characters like the Tags block (U+E0000+) are
 * detected correctly instead of being read as two meaningless surrogate
 * halves.
 *
 * `safe` reflects only 'dangerous' threats. Legitimate bidi marks and
 * script joiners are still reported in `threats` for visibility, but they
 * never make a string unsafe.
 */
export function scan(input: string): ScanResult {
  const threats: Threat[] = []
  let index = 0

  for (const char of input) {
    const codePoint = char.codePointAt(0)!
    const category = classify(codePoint)
    if (category) {
      threats.push({
        category,
        severity: severityOf(category),
        char,
        codePoint,
        index,
        name: nameFor(codePoint),
      })
    }
    index += char.length
  }

  const safe = threats.every(t => t.severity !== 'dangerous')
  return {safe, threats}
}

export function isSafe(input: string): boolean {
  return scan(input).safe
}
