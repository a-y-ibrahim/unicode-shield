import {scan} from '../../scan'
import {flagAsBoolean, type ParsedArgs} from '../args'
import {resolveFiles, readTextFile} from '../file-walk'
import {formatScanHuman, formatScanJson, type FileScanResult} from '../format'
import {buildLineIndex, indexToLineColumn} from '../position'
import {STDIN_ARG, readStdin} from '../stdin'
import type {CommandResult} from '../types'

const USAGE = 'Usage: unicode-shield scan <path> [--json]  (path can be - for stdin)'
const STDIN_PATH_LABEL = '(stdin)'

function scanText(path: string, text: string): FileScanResult {
  const scanResult = scan(text)
  const newlineIndices = buildLineIndex(text)
  const threats = scanResult.threats.map(threat => ({
    ...threat,
    ...indexToLineColumn(newlineIndices, threat.index),
  }))
  return {path, safe: scanResult.safe, threats}
}

export function runScan(args: ParsedArgs): CommandResult {
  const [inputPath] = args.positionals
  if (inputPath === undefined) {
    return {exitCode: 2, output: USAGE}
  }

  const useJson = flagAsBoolean(args.flags, 'json')

  if (inputPath === STDIN_ARG) {
    let text: string
    try {
      text = readStdin()
    } catch (error) {
      return {exitCode: 2, output: `Error reading stdin: ${error instanceof Error ? error.message : String(error)}`}
    }
    const result = scanText(STDIN_PATH_LABEL, text)
    return {
      exitCode: result.safe ? 0 : 1,
      output: useJson ? formatScanJson([result]) : formatScanHuman([result]),
    }
  }

  let paths: string[]
  let unreadableDirectories: string[]
  try {
    ;({files: paths, unreadableDirectories} = resolveFiles(inputPath))
  } catch (error) {
    return {exitCode: 2, output: `Error: ${error instanceof Error ? error.message : String(error)}`}
  }

  const results: FileScanResult[] = paths.map(path => {
    try {
      return scanText(path, readTextFile(path))
    } catch (error) {
      return {path, safe: true, threats: [], error: error instanceof Error ? error.message : String(error)}
    }
  })

  const overallSafe =
    unreadableDirectories.length === 0 && results.every(result => result.safe && result.error === undefined)

  return {
    exitCode: overallSafe ? 0 : 1,
    output: useJson ? formatScanJson(results, unreadableDirectories) : formatScanHuman(results, unreadableDirectories),
  }
}
