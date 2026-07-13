export type ThreatCategory =
  | 'bidi-embedding'
  | 'bidi-isolate'
  | 'bidi-mark'
  | 'joiner'
  | 'invisible'
  | 'tag'
  | 'variation-selector'
  | 'combining-marks'

/**
 * 'dangerous' categories have no legitimate use in a short user-supplied
 * string and are stripped by sanitize() by default. 'informational'
 * categories (bidi-mark, joiner) are real, legitimate characters that
 * correct RTL text, Persian/Indic text, and emoji sequences depend on;
 * scan() reports them so callers have full visibility, but sanitize()
 * never touches them unless explicitly asked to.
 */
export type Severity = 'dangerous' | 'informational'

export interface Threat {
  category: ThreatCategory
  severity: Severity
  char: string
  codePoint: number
  index: number
  name: string
}

export interface ScanResult {
  /** True when there are zero 'dangerous' threats. Informational threats
   *  (legitimate bidi marks, script joiners) never make a string unsafe. */
  safe: boolean
  /** Every threat found, dangerous and informational alike. */
  threats: Threat[]
}

export interface SanitizeOptions {
  /**
   * Which threat categories to strip. Defaults to every 'dangerous'
   * category. Pass this explicitly to also strip 'bidi-mark' or 'joiner'
   * characters, but doing so will break correct RTL text or emoji.
   */
  categories?: ThreatCategory[]
  /** String to substitute for each stripped character. Defaults to ''. */
  replacement?: string
}
