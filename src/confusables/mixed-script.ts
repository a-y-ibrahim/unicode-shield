import {SCRIPT_NAMES, SCRIPT_RANGES} from '../data/scripts-data'
import {type MixedScriptResult, type SuspiciousScriptChar} from './types'

/** Scripts used across every other script (digits, punctuation, combining
 *  marks, ...), excluded from mixing decisions on Unicode's own authority:
 *  their presence never indicates spoofing by itself. */
const SCRIPT_MIXING_EXCLUDED = new Set(['Common', 'Inherited'])

/** Binary search: SCRIPT_RANGES is sorted by start and non-overlapping, so
 *  a code point belongs to at most one range. Returns null for code points
 *  Unicode hasn't assigned a script to. */
function findScriptName(codePoint: number): string | null {
  let low = 0
  let high = SCRIPT_RANGES.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const range = SCRIPT_RANGES[mid]!
    if (codePoint < range[0]) {
      high = mid - 1
    } else if (codePoint > range[1]) {
      low = mid + 1
    } else {
      return SCRIPT_NAMES[range[2]]!
    }
  }
  return null
}

/**
 * Flags a string that mixes two or more scripts outside of Common and
 * Inherited, the pattern behind domain/identity spoofing like an "apple"
 * with a Cyrillic а substituted for the Latin one. This is a practical
 * heuristic, not an implementation of UTS #39's full restriction-level
 * algorithm: it reports the majority script (by character count, ties
 * broken by first appearance) and flags everything else as suspicious.
 */
export function detectMixedScript(input: string): MixedScriptResult {
  if (typeof input !== 'string') {
    throw new TypeError(`unicode-shield: detectMixedScript() expects a string, received ${typeof input}`)
  }

  const relevant: SuspiciousScriptChar[] = []
  const scriptOrder: string[] = []
  const seenScripts = new Set<string>()
  const counts = new Map<string, number>()

  let index = 0
  for (const char of input) {
    const codePoint = char.codePointAt(0)!
    const script = findScriptName(codePoint)
    if (script !== null && !SCRIPT_MIXING_EXCLUDED.has(script)) {
      relevant.push({char, codePoint, index, script})
      counts.set(script, (counts.get(script) ?? 0) + 1)
      if (!seenScripts.has(script)) {
        seenScripts.add(script)
        scriptOrder.push(script)
      }
    }
    index += char.length
  }

  if (scriptOrder.length <= 1) {
    return {mixed: false, scripts: scriptOrder, suspicious: []}
  }

  let majorityScript = scriptOrder[0]!
  let majorityCount = 0
  for (const script of scriptOrder) {
    const count = counts.get(script)!
    if (count > majorityCount) {
      majorityCount = count
      majorityScript = script
    }
  }

  const suspicious = relevant.filter(c => c.script !== majorityScript)

  return {mixed: true, scripts: scriptOrder, suspicious}
}
