import {scan} from './scan'
import {type SanitizeOptions, type ThreatCategory} from './types'

const DANGEROUS_CATEGORIES: ThreatCategory[] = ['bidi-embedding', 'bidi-isolate', 'invisible', 'tag']

/**
 * Strips threats found by scan() from a string. By default this strips
 * every 'dangerous' category (bidi embeddings/overrides, bidi isolates,
 * invisible characters, Unicode Tag characters), the ones with no
 * legitimate use in a short user-supplied string. 'informational'
 * threats (bidi marks, script joiners) are never stripped unless a
 * caller explicitly lists them in `options.categories`, since real RTL
 * text, Persian/Indic text, and emoji sequences depend on them.
 */
export function sanitize(input: string, options: SanitizeOptions = {}): string {
  const categories = options.categories ?? DANGEROUS_CATEGORIES
  const replacement = options.replacement ?? ''
  const {threats} = scan(input)
  if (threats.length === 0) return input

  let result = ''
  let cursor = 0
  for (const threat of threats) {
    if (!categories.includes(threat.category)) continue
    result += input.slice(cursor, threat.index)
    result += replacement
    cursor = threat.index + threat.char.length
  }
  result += input.slice(cursor)
  return result
}
