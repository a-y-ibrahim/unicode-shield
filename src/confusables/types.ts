export interface SuspiciousScriptChar {
  char: string
  codePoint: number
  index: number
  script: string
}

export interface MixedScriptResult {
  /** True when the input mixes two or more scripts outside of Common and
   *  Inherited (which are excluded because they're shared by every script,
   *  for example digits and punctuation, and never indicate mixing on
   *  their own). */
  mixed: boolean
  /** Every non-Common, non-Inherited script found, in first-seen order. */
  scripts: string[]
  /** The characters belonging to whichever scripts are NOT the majority
   *  script, the ones actually worth showing a caller: in `"аpple"` this is
   *  just the Cyrillic а, not all four Latin letters. Empty when `mixed` is
   *  false. */
  suspicious: SuspiciousScriptChar[]
}
