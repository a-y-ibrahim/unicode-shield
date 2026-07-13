// Regenerates src/data/confusables-data.ts, src/data/scripts-data.ts, and
// src/data/combining-marks-data.ts from Unicode's official data files. Not
// part of the normal build: run it by hand when picking up a new Unicode
// version.
//
//   node scripts/generate-unicode-data.mjs

import {writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const CONFUSABLES_URL = 'https://www.unicode.org/Public/security/latest/confusables.txt'
const SCRIPTS_URL = 'https://www.unicode.org/Public/UCD/latest/ucd/Scripts.txt'
const GENERAL_CATEGORY_URL = 'https://www.unicode.org/Public/UCD/latest/ucd/extracted/DerivedGeneralCategory.txt'

const dataDir = fileURLToPath(new URL('../src/data', import.meta.url))

function parseHeader(text) {
  const lines = text.split('\n')
  const dateLine = lines.find(l => l.startsWith('# Date:'))
  const versionLine = lines.find(l => l.startsWith('# Version:'))
  // Files like Scripts.txt put the version in the filename comment on line 1
  // (e.g. "# Scripts-17.0.0.txt") instead of a separate "# Version:" line.
  const filenameVersionMatch = lines[0]?.match(/-(\d+\.\d+\.\d+)\.txt/)
  return {
    date: dateLine ? dateLine.replace('# Date:', '').trim() : 'unknown',
    version: versionLine
      ? versionLine.replace('# Version:', '').trim()
      : (filenameVersionMatch ? filenameVersionMatch[1] : 'unknown'),
  }
}

function toHex(codePoint) {
  return '0x' + codePoint.toString(16)
}

async function generateConfusables() {
  console.log(`Fetching ${CONFUSABLES_URL} ...`)
  const res = await fetch(CONFUSABLES_URL)
  if (!res.ok) throw new Error(`Failed to fetch confusables.txt: ${res.status} ${res.statusText}`)
  const text = await res.text()
  const {date, version} = parseHeader(text)

  const seenSources = new Set()
  const entries = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split(';')
    if (parts.length < 3) continue
    const source = parseInt(parts[0].trim(), 16)
    const targets = parts[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(hex => parseInt(hex, 16))
    if (Number.isNaN(source) || targets.some(Number.isNaN)) {
      throw new Error(`Unparseable confusables.txt line: ${line}`)
    }
    if (seenSources.has(source)) {
      throw new Error(`Unexpected duplicate source in confusables.txt: ${toHex(source)}`)
    }
    seenSources.add(source)
    entries.push([source, targets])
  }
  entries.sort((a, b) => a[0] - b[0])

  const body = entries.map(([source, targets]) => `  [${toHex(source)}, [${targets.map(toHex).join(', ')}]],`).join('\n')

  const output = `/**
 * Generated from Unicode's official confusables.txt (UTS #39 security
 * data), do not edit by hand. Regenerate with:
 *   node scripts/generate-unicode-data.mjs
 *
 * Source: ${CONFUSABLES_URL}
 * Unicode version: ${version}
 * Data date: ${date}
 * Entries: ${entries.length}
 * License: Unicode-3.0, see ../../THIRD_PARTY_NOTICES.md
 */

/**
 * Maps a code point to the code point sequence Unicode considers its
 * confusable "prototype" (the UTS #39 skeleton substitution). A source
 * never appears as a target elsewhere in this table, so a single
 * substitution pass is always enough, no chained lookups needed.
 */
export const CONFUSABLES_SKELETON_MAP: ReadonlyMap<number, readonly number[]> = new Map([
${body}
])
`

  writeFileSync(`${dataDir}/confusables-data.ts`, output, 'utf8')
  console.log(`Wrote confusables-data.ts: ${entries.length} entries`)
}

async function generateScripts() {
  console.log(`Fetching ${SCRIPTS_URL} ...`)
  const res = await fetch(SCRIPTS_URL)
  if (!res.ok) throw new Error(`Failed to fetch Scripts.txt: ${res.status} ${res.statusText}`)
  const text = await res.text()
  const {date, version} = parseHeader(text)

  const scriptNames = []
  const scriptIndex = new Map()
  function indexOf(name) {
    let i = scriptIndex.get(name)
    if (i === undefined) {
      i = scriptNames.length
      scriptNames.push(name)
      scriptIndex.set(name, i)
    }
    return i
  }

  const ranges = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split(';')
    if (parts.length < 2) continue
    const rangePart = parts[0].trim()
    const nameMatch = parts[1].match(/^\s*(\w+)/)
    if (!nameMatch) continue
    const name = nameMatch[1]

    let start
    let end
    if (rangePart.includes('..')) {
      const [s, e] = rangePart.split('..')
      start = parseInt(s, 16)
      end = parseInt(e, 16)
    } else {
      start = parseInt(rangePart, 16)
      end = start
    }
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error(`Unparseable Scripts.txt line: ${line}`)
    }
    ranges.push([start, end, indexOf(name)])
  }
  ranges.sort((a, b) => a[0] - b[0])

  // Sanity check: ranges must not overlap, the lookup below assumes that.
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] <= ranges[i - 1][1]) {
      throw new Error(`Overlapping Scripts.txt ranges: ${JSON.stringify(ranges[i - 1])} and ${JSON.stringify(ranges[i])}`)
    }
  }

  const namesBody = scriptNames.map(n => `  '${n}',`).join('\n')
  const rangesBody = ranges.map(([s, e, i]) => `  [${toHex(s)}, ${toHex(e)}, ${i}],`).join('\n')

  const output = `/**
 * Generated from Unicode's official Scripts.txt, do not edit by hand.
 * Regenerate with:
 *   node scripts/generate-unicode-data.mjs
 *
 * Source: ${SCRIPTS_URL}
 * Unicode version: ${version}
 * Data date: ${date}
 * Ranges: ${ranges.length}, scripts: ${scriptNames.length}
 * License: Unicode-3.0, see ../../THIRD_PARTY_NOTICES.md
 */

export const SCRIPT_NAMES: readonly string[] = [
${namesBody}
]

/**
 * Sorted by start code point and non-overlapping, so a lookup can binary
 * search on start. Each entry is [start, end, index into SCRIPT_NAMES].
 */
export const SCRIPT_RANGES: readonly (readonly [number, number, number])[] = [
${rangesBody}
]
`

  writeFileSync(`${dataDir}/scripts-data.ts`, output, 'utf8')
  console.log(`Wrote scripts-data.ts: ${ranges.length} ranges, ${scriptNames.length} scripts`)
}

async function generateCombiningMarks() {
  console.log(`Fetching ${GENERAL_CATEGORY_URL} ...`)
  const res = await fetch(GENERAL_CATEGORY_URL)
  if (!res.ok) throw new Error(`Failed to fetch DerivedGeneralCategory.txt: ${res.status} ${res.statusText}`)
  const text = await res.text()
  const {date, version} = parseHeader(text)

  const ranges = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split(';')
    if (parts.length < 2) continue
    const categoryMatch = parts[1].match(/^\s*(\w+)/)
    // Mn = Nonspacing_Mark: combining marks that stack on a base character
    // without taking up their own space, the mechanism "Zalgo text" abuse
    // relies on. Mc (spacing) and Me (enclosing) are deliberately excluded,
    // they don't produce the same unbounded visual stacking.
    if (!categoryMatch || categoryMatch[1] !== 'Mn') continue

    const rangePart = parts[0].trim()
    let start
    let end
    if (rangePart.includes('..')) {
      const [s, e] = rangePart.split('..')
      start = parseInt(s, 16)
      end = parseInt(e, 16)
    } else {
      start = parseInt(rangePart, 16)
      end = start
    }
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error(`Unparseable DerivedGeneralCategory.txt line: ${line}`)
    }
    ranges.push([start, end])
  }
  ranges.sort((a, b) => a[0] - b[0])

  // DerivedGeneralCategory.txt already lists maximal ranges per category,
  // but merge defensively in case that ever changes.
  const merged = []
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }

  // Sanity check: merged ranges must not overlap, the lookup below assumes that.
  for (let i = 1; i < merged.length; i++) {
    if (merged[i][0] <= merged[i - 1][1]) {
      throw new Error(`Overlapping merged Mn ranges: ${JSON.stringify(merged[i - 1])} and ${JSON.stringify(merged[i])}`)
    }
  }

  const totalCodePoints = merged.reduce((sum, [s, e]) => sum + (e - s + 1), 0)
  const body = merged.map(([s, e]) => `  [${toHex(s)}, ${toHex(e)}],`).join('\n')

  const output = `/**
 * Generated from Unicode's official DerivedGeneralCategory.txt, do not
 * edit by hand. Regenerate with:
 *   node scripts/generate-unicode-data.mjs
 *
 * Source: ${GENERAL_CATEGORY_URL}
 * Unicode version: ${version}
 * Data date: ${date}
 * Ranges: ${merged.length}, code points: ${totalCodePoints}
 * Category: Mn (Nonspacing_Mark)
 * License: Unicode-3.0, see ../../THIRD_PARTY_NOTICES.md
 */

/**
 * Sorted by start code point and non-overlapping, so a lookup can binary
 * search on start. Each entry is [start, end].
 */
export const NONSPACING_MARK_RANGES: readonly (readonly [number, number])[] = [
${body}
]
`

  writeFileSync(`${dataDir}/combining-marks-data.ts`, output, 'utf8')
  console.log(`Wrote combining-marks-data.ts: ${merged.length} ranges, ${totalCodePoints} code points`)
}

await generateConfusables()
await generateScripts()
await generateCombiningMarks()
