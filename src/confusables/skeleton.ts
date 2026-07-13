import {CONFUSABLES_SKELETON_MAP} from '../data/confusables-data'

/**
 * The UTS #39 "skeleton" of a string: NFD-normalize, replace every code
 * point that has a known confusable prototype with that prototype, then
 * NFD-normalize again (a substitution can itself need decomposing). Two
 * strings are visually confusable exactly when their skeletons match; see
 * https://www.unicode.org/reports/tr39/#Confusable_Detection.
 */
export function getSkeleton(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError(`unicode-shield: getSkeleton() expects a string, received ${typeof input}`)
  }

  const decomposed = input.normalize('NFD')
  let result = ''
  for (const char of decomposed) {
    const codePoint = char.codePointAt(0)!
    const mapped = CONFUSABLES_SKELETON_MAP.get(codePoint)
    if (mapped) {
      for (const target of mapped) result += String.fromCodePoint(target)
    } else {
      result += char
    }
  }
  return result.normalize('NFD')
}

/**
 * True when `a` and `b` would look the same, or close enough to fool a
 * quick glance, for example a newly chosen username that's visually
 * indistinguishable from one that already exists.
 */
export function areConfusable(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new TypeError(
      `unicode-shield: areConfusable() expects two strings, received ${typeof a} and ${typeof b}`,
    )
  }
  return getSkeleton(a) === getSkeleton(b)
}
