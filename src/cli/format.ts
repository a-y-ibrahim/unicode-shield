import type {Threat} from '../types'
import {type LineColumn} from './position'

export type PositionedThreat = Threat & LineColumn

export interface FileScanResult {
  path: string
  safe: boolean
  threats: PositionedThreat[]
  error?: string
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function codePointHex(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase()}`
}

export function formatScanHuman(results: FileScanResult[]): string {
  const lines: string[] = []
  let totalThreats = 0
  let filesWithThreats = 0
  let filesWithErrors = 0

  for (const result of results) {
    if (result.error !== undefined) {
      filesWithErrors++
      lines.push(result.path)
      lines.push(`  error: ${result.error}`)
      continue
    }
    if (result.threats.length === 0) continue

    filesWithThreats++
    lines.push(result.path)
    for (const threat of result.threats) {
      totalThreats++
      lines.push(
        `  ${threat.line}:${threat.column}  ${threat.severity}  ${threat.category}  ${threat.name} (${codePointHex(threat.codePoint)})`,
      )
    }
  }

  const summaryParts = [
    totalThreats === 0 ? 'No threats found' : `Found ${pluralize(totalThreats, 'threat')} in ${pluralize(filesWithThreats, 'file')}`,
    `${pluralize(results.length, 'file')} scanned`,
  ]
  if (filesWithErrors > 0) summaryParts.push(`${pluralize(filesWithErrors, 'file')} could not be read`)

  return [...lines, '', `${summaryParts.join(', ')}.`].join('\n')
}

export function formatScanJson(results: FileScanResult[]): string {
  const safe = results.every(result => result.safe && result.error === undefined)
  return JSON.stringify({safe, filesScanned: results.length, files: results}, null, 2)
}
