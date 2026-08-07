import {scan} from '../../scan'
import {flagAsBoolean, flagAsString, type ParsedArgs} from '../args'
import {resolveFiles, readTextFile} from '../file-walk'
import {formatScanHuman, formatScanJson, type FileScanResult} from '../format'
import {buildLineIndex, indexToLineColumn} from '../position'
import {formatScanSarif} from '../sarif'
import {STDIN_ARG, readStdin} from '../stdin'
import {STDIN_PATH_LABEL} from '../stdin-label'
import type {CommandResult} from '../types'
import {getPackageVersion} from '../version'

const USAGE =
  'Usage: unicode-shield scan <path> [--json] [--format human|json|sarif]  (path can be - for stdin)'
const VALID_FORMATS = new Set(['human', 'json', 'sarif'])

/**
 * `--json` predates `--format` and stays as a shorthand for `--format
 * json` rather than being removed, so an existing `scan path --json`
 * invocation (action/annotate.mjs's own included) keeps working unchanged.
 * Giving both at once is only ever a mistake, not a meaningful override
 * either way, so it's rejected rather than silently picking one.
 */
function resolveFormat(args: ParsedArgs): {format: 'human' | 'json' | 'sarif'} | {error: string} {
  const useJson = flagAsBoolean(args.flags, 'json')
  const formatFlag = flagAsString(args.flags, 'format')

  if (formatFlag === undefined) {
    return {format: useJson ? 'json' : 'human'}
  }
  if (!VALID_FORMATS.has(formatFlag)) {
    return {error: `Unknown format: ${JSON.stringify(formatFlag)}. Valid formats: human, json, sarif.`}
  }
  if (useJson && formatFlag !== 'json') {
    return {error: `--json conflicts with --format ${formatFlag}. Use one or the other.`}
  }
  return {format: formatFlag as 'human' | 'json' | 'sarif'}
}

function render(format: 'human' | 'json' | 'sarif', results: FileScanResult[], unreadableDirectories: string[]): string {
  if (format === 'sarif') return formatScanSarif(results, unreadableDirectories, getPackageVersion(import.meta.url))
  if (format === 'json') return formatScanJson(results, unreadableDirectories)
  return formatScanHuman(results, unreadableDirectories)
}

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

  const resolvedFormat = resolveFormat(args)
  if ('error' in resolvedFormat) {
    return {exitCode: 2, output: `Error: ${resolvedFormat.error}`}
  }
  const {format} = resolvedFormat

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
      output: render(format, [result], []),
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
    output: render(format, results, unreadableDirectories),
  }
}
