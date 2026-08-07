import type {ThreatCategory} from '../types'
import type {FileScanResult, PositionedThreat} from './format'
import {STDIN_PATH_LABEL} from './stdin-label'

// Minimal SARIF 2.1.0 types for exactly what this formatter emits, not a
// general-purpose SARIF library: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
type SarifLevel = 'note' | 'warning' | 'error'

interface SarifRule {
  id: string
  name: string
  shortDescription: {text: string}
  fullDescription: {text: string}
  helpUri: string
  defaultConfiguration: {level: SarifLevel}
  properties: {
    tags: string[]
    precision: 'high' | 'very-high'
    'security-severity'?: string
  }
}

interface SarifResult {
  ruleId: string
  level: SarifLevel
  message: {text: string}
  locations?: [
    {
      physicalLocation: {
        artifactLocation: {uri: string}
        region?: {startLine: number; startColumn: number}
      }
    },
  ]
}

interface SarifLog {
  $schema: string
  version: '2.1.0'
  runs: [
    {
      tool: {
        driver: {
          name: string
          informationUri: string
          version: string
          rules: SarifRule[]
        }
      }
      results: SarifResult[]
    },
  ]
}

const HELP_URI = 'https://github.com/a-y-ibrahim/unicode-shield#readme'

/**
 * One rule per ThreatCategory plus two for a file/directory unicode-shield
 * couldn't read at all, which get reported as findings too (see format.ts's
 * formatScanHuman/formatScanJson, which already treat an unreadable path as
 * unsafe rather than silently clean).
 *
 * `note` for `bidi-mark`/`joiner` rather than `warning`: these categories
 * are legitimate, correct text (RTL direction marks, emoji/script joiners),
 * never stripped by default, so SARIF's three-level scale has a more
 * accurate level available than the two-level error/warning split
 * action/annotate.mjs's GitHub workflow-command output is limited to.
 *
 * `security-severity` follows GitHub Code Scanning's own convention (a
 * 0-10, CVSS-shaped string used to color and sort the Security tab), and
 * is this tool's own judgment, not a citation of an external score: none
 * of these categories has a CVE of their own. `external/cwe/cwe-1007`
 * (Insufficient Visual Distinction of Homoglyphs Presented to User) is
 * included only for the two bidi categories, the specific CWE the 2021
 * "Trojan Source" disclosure (CVE-2021-42574) was filed under; the other
 * categories are left without a CWE tag rather than guessing one.
 */
const RULES: Record<ThreatCategory | 'unreadable-file' | 'unreadable-directory', SarifRule> = {
  'bidi-embedding': {
    id: 'bidi-embedding',
    name: 'BidiEmbeddingOrOverride',
    shortDescription: {text: 'Bidi embedding or override character'},
    fullDescription: {
      text: 'A bidi embedding or override control character (LRE, RLE, LRO, RLO, PDF) can reorder how surrounding text displays without changing its underlying bytes, the mechanism behind the 2021 "Trojan Source" disclosure (CVE-2021-42574).',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'error'},
    properties: {tags: ['security', 'external/cwe/cwe-1007'], precision: 'very-high', 'security-severity': '7.5'},
  },
  'bidi-isolate': {
    id: 'bidi-isolate',
    name: 'BidiIsolate',
    shortDescription: {text: 'Bidi isolate character'},
    fullDescription: {
      text: 'A bidi isolate control character (LRI, RLI, FSI, PDI) can reorder how surrounding text displays without changing its underlying bytes, the same class of issue as a bidi embedding or override character.',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'error'},
    properties: {tags: ['security', 'external/cwe/cwe-1007'], precision: 'very-high', 'security-severity': '7.5'},
  },
  invisible: {
    id: 'invisible',
    name: 'InvisibleCharacter',
    shortDescription: {text: 'Invisible character'},
    fullDescription: {
      text: 'A character that renders as nothing in every mainstream font (a zero-width space, word joiner, or stray byte-order mark), which can pad or duplicate identity strings so two visually identical values compare as different, or smuggle content past a naive filter.',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'error'},
    properties: {tags: ['security'], precision: 'very-high', 'security-severity': '5.0'},
  },
  tag: {
    id: 'tag',
    name: 'DeprecatedUnicodeTagCharacter',
    shortDescription: {text: 'Deprecated Unicode tag character'},
    fullDescription: {
      text: 'A code point from the deprecated Unicode Tags block (U+E0000-U+E007F), repurposed since 2024 as a prompt-injection vector: it renders as nothing in every mainstream font, yet some LLMs still read and act on the text it encodes.',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'error'},
    properties: {tags: ['security'], precision: 'very-high', 'security-severity': '7.0'},
  },
  'variation-selector': {
    id: 'variation-selector',
    name: 'VariationSelectorSupplement',
    shortDescription: {text: 'Variation Selectors Supplement character'},
    fullDescription: {
      text: 'A code point from the Variation Selectors Supplement (U+E0100-U+E01EF), repurposed since 2024 as a prompt-injection vector alongside the Unicode Tags block.',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'error'},
    properties: {tags: ['security'], precision: 'very-high', 'security-severity': '7.0'},
  },
  'combining-marks': {
    id: 'combining-marks',
    name: 'ExcessiveCombiningMarks',
    shortDescription: {text: 'Excessive stacked combining marks (Zalgo text)'},
    fullDescription: {
      text: 'More than 6 nonspacing combining marks stacked on a single base character, the technique behind "Zalgo text" abuse: visual harassment, or corrupting how a chat message or username displays.',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'error'},
    properties: {tags: ['security'], precision: 'high', 'security-severity': '4.0'},
  },
  'bidi-mark': {
    id: 'bidi-mark',
    name: 'BidiMark',
    shortDescription: {text: 'Bidi direction mark (informational)'},
    fullDescription: {
      text: 'A single-character direction hint (LRM, RLM, ALM) that correct Arabic, Hebrew, and other right-to-left text legitimately relies on. Reported for visibility only; never stripped by default.',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'note'},
    properties: {tags: ['correctness'], precision: 'very-high'},
  },
  joiner: {
    id: 'joiner',
    name: 'ScriptJoiner',
    shortDescription: {text: 'Zero-width joiner or non-joiner (informational)'},
    fullDescription: {
      text: 'A zero-width joiner or non-joiner, required for correct compound-emoji sequences and for word formation in Persian and several Indic scripts. Reported for visibility only; never stripped by default.',
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'note'},
    properties: {tags: ['correctness'], precision: 'very-high'},
  },
  'unreadable-file': {
    id: 'unreadable-file',
    name: 'UnreadableFile',
    shortDescription: {text: 'File could not be read'},
    fullDescription: {
      text: "unicode-shield could not read this file (a permissions error, or it disappeared mid-scan), so its contents were not checked for dangerous Unicode.",
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'warning'},
    properties: {tags: ['coverage-gap'], precision: 'very-high'},
  },
  'unreadable-directory': {
    id: 'unreadable-directory',
    name: 'UnreadableDirectory',
    shortDescription: {text: 'Directory could not be read'},
    fullDescription: {
      text: "unicode-shield could not list this directory (a permissions error, or it disappeared mid-scan), so none of its contents were checked for dangerous Unicode.",
    },
    helpUri: HELP_URI,
    defaultConfiguration: {level: 'warning'},
    properties: {tags: ['coverage-gap'], precision: 'very-high'},
  },
}

function codePointHex(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase()}`
}

const WINDOWS_DRIVE_LETTER = /^[A-Za-z]:/

/**
 * SARIF artifact locations are URIs, where `\` isn't a path separator, so a
 * Windows-style path built with `path.join` (`src\app.ts`) must be
 * normalized to `src/app.ts` first, confirmed against the SARIF spec's own
 * URI-reference requirement rather than assumed to not matter. Returns
 * undefined for a stdin-sourced result, which has no real file for a
 * location to point at; `locations` is an optional SARIF field for exactly
 * this case, rather than inventing a fake path.
 *
 * A drive-letter absolute path (`C:/repo/src`, which this action's own
 * SAFE_PATH allowlist and tests deliberately accept) needs a leading `/`
 * added, confirmed directly with Node's own URL parser: without it,
 * `C:/repo/src/app.ts` parses with `c:` read as the URI's scheme, not as
 * part of the path, silently discarding the drive letter (`new
 * URL('C:/repo/src/app.ts').pathname` is `/repo/src/app.ts`, no `C:`
 * anywhere). `/C:/repo/src/app.ts` parses correctly, the same convention
 * `file:` URLs use for Windows paths.
 */
function toArtifactUri(path: string): string | undefined {
  if (path === STDIN_PATH_LABEL) return undefined
  const normalized = path.replace(/\\/g, '/')
  return WINDOWS_DRIVE_LETTER.test(normalized) ? `/${normalized}` : normalized
}

/**
 * The message body's own complete noun phrase per category, kept separate
 * from each rule's shortDescription rather than derived from it by
 * mechanically lowercasing and gluing on a hardcoded "a": that gets the
 * article wrong for a description that starts with a vowel sound
 * ('invisible' needs "an", not "a"), and produces a singular/plural
 * mismatch for combining-marks ("a ... marks" is not grammatical).
 */
const MESSAGE_NOUN_PHRASES: Record<ThreatCategory, string> = {
  'bidi-embedding': 'a bidi embedding or override character',
  'bidi-isolate': 'a bidi isolate character',
  invisible: 'an invisible character',
  tag: 'a deprecated Unicode tag character',
  'variation-selector': 'a Variation Selectors Supplement character',
  'combining-marks': 'an excessively stacked combining mark',
  'bidi-mark': 'a bidi direction mark',
  joiner: 'a zero-width joiner or non-joiner',
}

function threatResult(threat: PositionedThreat, path: string): SarifResult {
  const rule = RULES[threat.category]
  const uri = toArtifactUri(path)
  return {
    ruleId: threat.category,
    level: rule.defaultConfiguration.level,
    message: {text: `${threat.name} (${codePointHex(threat.codePoint)}), ${MESSAGE_NOUN_PHRASES[threat.category]}`},
    ...(uri === undefined
      ? {}
      : {locations: [{physicalLocation: {artifactLocation: {uri}, region: {startLine: threat.line, startColumn: threat.column}}}]}),
  }
}

function unreadableFileResult(path: string, error: string): SarifResult {
  const uri = toArtifactUri(path)
  return {
    ruleId: 'unreadable-file',
    level: RULES['unreadable-file'].defaultConfiguration.level,
    message: {text: `unicode-shield could not read this file: ${error}`},
    ...(uri === undefined ? {} : {locations: [{physicalLocation: {artifactLocation: {uri}}}]}),
  }
}

function unreadableDirectoryResult(directoryPath: string): SarifResult {
  const uri = toArtifactUri(directoryPath)
  return {
    ruleId: 'unreadable-directory',
    level: RULES['unreadable-directory'].defaultConfiguration.level,
    message: {text: `unicode-shield could not read this directory, its contents were not scanned: ${directoryPath}`},
    ...(uri === undefined ? {} : {locations: [{physicalLocation: {artifactLocation: {uri}}}]}),
  }
}

/**
 * SARIF 2.1.0 output for `github/codeql-action/upload-sarif`, so findings
 * show up in the repository's Security > Code scanning tab (persistent,
 * trackable, dismissible-with-a-reason) rather than only as transient PR
 * annotations. `toolVersion` is this package's own version (from
 * getPackageVersion), embedded in `tool.driver.version` so a Security tab
 * alert records which unicode-shield version found it.
 */
export function formatScanSarif(results: FileScanResult[], unreadableDirectories: string[], toolVersion: string): string {
  const sarifResults: SarifResult[] = []

  for (const file of results) {
    for (const threat of file.threats) {
      sarifResults.push(threatResult(threat, file.path))
    }
    if (file.error !== undefined) {
      sarifResults.push(unreadableFileResult(file.path, file.error))
    }
  }
  for (const directoryPath of unreadableDirectories) {
    sarifResults.push(unreadableDirectoryResult(directoryPath))
  }

  const log: SarifLog = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'unicode-shield',
            informationUri: 'https://github.com/a-y-ibrahim/unicode-shield',
            version: toolVersion,
            rules: Object.values(RULES),
          },
        },
        results: sarifResults,
      },
    ],
  }

  return JSON.stringify(log, null, 2)
}
