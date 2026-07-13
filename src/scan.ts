import {MAX_COMBINING_MARKS_PER_BASE, classify, isNonspacingMark, nameFor, severityOf} from './data/ranges'
import {type ScanResult, type Threat} from './types'

/**
 * Scans a string for bidi embedding/override characters, bidi isolates,
 * bidi marks, script joiners, invisible characters, Unicode Tag
 * characters, Variation Selectors Supplement characters, and excessive
 * stacked combining marks ("Zalgo text"). Iterates by Unicode code point
 * (not UTF-16 code unit) so supplementary-plane characters like the Tags
 * block (U+E0000+) and the Variation Selectors Supplement (U+E0100+) are
 * detected correctly instead of being read as two meaningless surrogate
 * halves.
 *
 * `safe` reflects only 'dangerous' threats. Legitimate bidi marks and
 * script joiners are still reported in `threats` for visibility, but they
 * never make a string unsafe.
 */
export function scan(input: string): ScanResult {
  if (typeof input !== 'string') {
    throw new TypeError(
      `unicode-shield: scan() expects a string, received ${typeof input}`,
    )
  }

  const threats: Threat[] = []
  let index = 0
  let combiningRun = 0

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
      // A code point classify() already recognizes (variation selectors in
      // particular are also Nonspacing_Mark) has its own dedicated
      // handling above; don't let it affect the Zalgo run count either way.
    } else if (isNonspacingMark(codePoint)) {
      combiningRun += 1
      if (combiningRun > MAX_COMBINING_MARKS_PER_BASE) {
        threats.push({
          category: 'combining-marks',
          severity: severityOf('combining-marks'),
          char,
          codePoint,
          index,
          name: nameFor(codePoint),
        })
      }
    } else {
      combiningRun = 0
    }
    index += char.length
  }

  const safe = threats.every(t => t.severity !== 'dangerous')
  return {safe, threats}
}

export function isSafe(input: string): boolean {
  return scan(input).safe
}
