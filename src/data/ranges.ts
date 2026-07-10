import {type Severity, type ThreatCategory} from '../types'

interface CharDef {
  codePoint: number
  name: string
}

/**
 * Directional embeddings and overrides. Deprecated by Unicode in favor of
 * isolates (see BIDI_ISOLATES), and the exact mechanism behind the 2021
 * "Trojan Source" disclosure (CVE-2021-42574) and the class of bug this
 * library's author fixed in bluesky-social/social-app#11066. A short
 * user-supplied string (a username, a display name, a chat message) almost
 * never has a legitimate reason to contain these. Dangerous.
 */
export const BIDI_EMBEDDINGS: CharDef[] = [
  {codePoint: 0x202a, name: 'LEFT-TO-RIGHT EMBEDDING'},
  {codePoint: 0x202b, name: 'RIGHT-TO-LEFT EMBEDDING'},
  {codePoint: 0x202c, name: 'POP DIRECTIONAL FORMATTING'},
  {codePoint: 0x202d, name: 'LEFT-TO-RIGHT OVERRIDE'},
  {codePoint: 0x202e, name: 'RIGHT-TO-LEFT OVERRIDE'},
]

/**
 * Directional isolates. Safer than embeddings in long-form documents
 * because they don't leak direction into surrounding text, but still
 * exploitable for spoofing when unpaired or nested in a short identifier.
 * Dangerous.
 */
export const BIDI_ISOLATES: CharDef[] = [
  {codePoint: 0x2066, name: 'LEFT-TO-RIGHT ISOLATE'},
  {codePoint: 0x2067, name: 'RIGHT-TO-LEFT ISOLATE'},
  {codePoint: 0x2068, name: 'FIRST STRONG ISOLATE'},
  {codePoint: 0x2069, name: 'POP DIRECTIONAL ISOLATE'},
]

/**
 * Single-character directional marks. Legitimate and common in real
 * multilingual text (for example, hinting the direction of a neutral
 * character like a period next to Arabic or Hebrew text). Informational:
 * reported by scan(), never stripped by sanitize() by default, because
 * stripping them by default would corrupt correct RTL text, the opposite
 * of what this library is for.
 */
export const BIDI_MARKS: CharDef[] = [
  {codePoint: 0x200e, name: 'LEFT-TO-RIGHT MARK'},
  {codePoint: 0x200f, name: 'RIGHT-TO-LEFT MARK'},
  {codePoint: 0x061c, name: 'ARABIC LETTER MARK'},
]

/**
 * Zero-width and invisible characters with no legitimate use in a short
 * user-supplied identifier or message. Commonly used to pad strings past
 * uniqueness checks, hide characters from moderation filters, or make two
 * visually identical strings compare as different. Dangerous.
 */
export const INVISIBLE: CharDef[] = [
  {codePoint: 0x200b, name: 'ZERO WIDTH SPACE'},
  {codePoint: 0x2060, name: 'WORD JOINER'},
  {codePoint: 0xfeff, name: 'ZERO WIDTH NO-BREAK SPACE (BOM)'},
  {codePoint: 0x180e, name: 'MONGOLIAN VOWEL SEPARATOR'},
  {codePoint: 0x00ad, name: 'SOFT HYPHEN'},
  {codePoint: 0x115f, name: 'HANGUL CHOSEONG FILLER'},
  {codePoint: 0x1160, name: 'HANGUL JUNGSEONG FILLER'},
  {codePoint: 0x3164, name: 'HANGUL FILLER'},
  {codePoint: 0xffa0, name: 'HALFWIDTH HANGUL FILLER'},
]

/**
 * Zero-width joiners that real scripts and emoji depend on. ZWJ (U+200D)
 * is how multi-person emoji sequences and many complex-script ligatures
 * are built; ZWNJ (U+200C) is required for correct word formation in
 * Persian and several Indic scripts. Informational: reported by scan(),
 * never stripped by sanitize() by default, since stripping them by default
 * would break legitimate emoji and legitimate text.
 */
export const SCRIPT_JOINERS: CharDef[] = [
  {codePoint: 0x200c, name: 'ZERO WIDTH NON-JOINER'},
  {codePoint: 0x200d, name: 'ZERO WIDTH JOINER'},
]

/**
 * The deprecated Unicode Tags block (U+E0000-U+E007F). Originally meant
 * for inline language tagging, deprecated by Unicode itself in 2003, and
 * revived since 2024 as an "ASCII smuggling" / invisible prompt-injection
 * vector: text and instructions encoded in these code points render as
 * nothing in every mainstream font, yet many LLMs still read and act on
 * them. No modern text has a legitimate reason to contain them. Dangerous.
 */
export const TAGS_RANGE: [number, number] = [0xe0000, 0xe007f]

/**
 * Variation Selectors Supplement (U+E0100-U+E01EF). Unicode-defined for
 * extremely narrow CJK ideograph variant selection, essentially never seen
 * in ordinary user-generated text. Documented since 2024 as a
 * "variation selector smuggling" technique: stacking many of these after a
 * base character encodes an arbitrary invisible byte payload, the same
 * class of attack as the Tags block above, different code points. Dangerous.
 *
 * Deliberately does NOT cover the base Variation Selectors block
 * (U+FE00-U+FE0F): VS15/VS16 are how ordinary text legitimately picks
 * text-style vs emoji-style presentation (for example after U+2764 to render
 * as an emoji heart), and are extremely common in real user text.
 */
export const VARIATION_SELECTORS_SUPPLEMENT_RANGE: [number, number] = [0xe0100, 0xe01ef]

const SEVERITY_BY_CATEGORY: Record<ThreatCategory, Severity> = {
  'bidi-embedding': 'dangerous',
  'bidi-isolate': 'dangerous',
  'bidi-mark': 'informational',
  joiner: 'informational',
  invisible: 'dangerous',
  tag: 'dangerous',
  'variation-selector': 'dangerous',
}

export function severityOf(category: ThreatCategory): Severity {
  return SEVERITY_BY_CATEGORY[category]
}

export function classify(codePoint: number): ThreatCategory | null {
  if (BIDI_EMBEDDINGS.some(c => c.codePoint === codePoint)) return 'bidi-embedding'
  if (BIDI_ISOLATES.some(c => c.codePoint === codePoint)) return 'bidi-isolate'
  if (BIDI_MARKS.some(c => c.codePoint === codePoint)) return 'bidi-mark'
  if (SCRIPT_JOINERS.some(c => c.codePoint === codePoint)) return 'joiner'
  if (INVISIBLE.some(c => c.codePoint === codePoint)) return 'invisible'
  if (codePoint >= TAGS_RANGE[0] && codePoint <= TAGS_RANGE[1]) return 'tag'
  if (
    codePoint >= VARIATION_SELECTORS_SUPPLEMENT_RANGE[0] &&
    codePoint <= VARIATION_SELECTORS_SUPPLEMENT_RANGE[1]
  ) {
    return 'variation-selector'
  }
  return null
}

export function nameFor(codePoint: number): string {
  const all = [...BIDI_EMBEDDINGS, ...BIDI_ISOLATES, ...BIDI_MARKS, ...INVISIBLE, ...SCRIPT_JOINERS]
  const found = all.find(c => c.codePoint === codePoint)
  if (found) return found.name
  if (codePoint >= TAGS_RANGE[0] && codePoint <= TAGS_RANGE[1]) {
    return `TAG (U+${codePoint.toString(16).toUpperCase()})`
  }
  if (
    codePoint >= VARIATION_SELECTORS_SUPPLEMENT_RANGE[0] &&
    codePoint <= VARIATION_SELECTORS_SUPPLEMENT_RANGE[1]
  ) {
    return `VARIATION SELECTOR SUPPLEMENT (U+${codePoint.toString(16).toUpperCase()})`
  }
  return `U+${codePoint.toString(16).toUpperCase()}`
}
