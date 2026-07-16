import {scan} from '../../scan'
import {flagAsBoolean, type ParsedArgs} from '../args'
import {resolveFiles, readTextFile} from '../file-walk'
import {formatScanHuman, formatScanJson, type FileScanResult} from '../format'
import {buildLineIndex, indexToLineColumn} from '../position'
import type {CommandResult} from '../types'

const USAGE = 'Usage: unicode-shield scan <path> [--json]'

export function runScan(args: ParsedArgs): CommandResult {
  const [inputPath] = args.positionals
  if (inputPath === undefined) {
    return {exitCode: 2, output: USAGE}
  }

  let paths: string[]
  try {
    paths = resolveFiles(inputPath)
  } catch (error) {
    return {exitCode: 2, output: `Error: ${error instanceof Error ? error.message : String(error)}`}
  }

  const results: FileScanResult[] = paths.map(path => {
    try {
      const text = readTextFile(path)
      const scanResult = scan(text)
      const newlineIndices = buildLineIndex(text)
      const threats = scanResult.threats.map(threat => ({
        ...threat,
        ...indexToLineColumn(newlineIndices, threat.index),
      }))
      return {path, safe: scanResult.safe, threats}
    } catch (error) {
      return {path, safe: true, threats: [], error: error instanceof Error ? error.message : String(error)}
    }
  })

  const useJson = flagAsBoolean(args.flags, 'json')
  const overallSafe = results.every(result => result.safe && result.error === undefined)

  return {
    exitCode: overallSafe ? 0 : 1,
    output: useJson ? formatScanJson(results) : formatScanHuman(results),
  }
}
