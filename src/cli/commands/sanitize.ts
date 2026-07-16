import {writeFileSync} from 'node:fs'

import {ALL_THREAT_CATEGORIES} from '../../data/ranges'
import {sanitize} from '../../sanitize'
import type {SanitizeOptions, ThreatCategory} from '../../types'
import {flagAsBoolean, flagAsString, type ParsedArgs} from '../args'
import {isDirectory, resolveFiles, readTextFile} from '../file-walk'
import type {CommandResult} from '../types'

const USAGE = 'Usage: unicode-shield sanitize <path> [--write] [--replacement <str>] [--categories <a,b,c>]'

/**
 * `--categories` arrives as an untyped string from argv, `as ThreatCategory[]`
 * alone would happily accept a typo like "bidi-marks" (plural, the real
 * category is singular) and silently strip nothing extra rather than
 * erroring, exactly the kind of mistake worth catching at the CLI layer
 * since nothing else validates it before it reaches sanitize().
 */
function parseCategories(raw: string): {categories: ThreatCategory[]} | {error: string} {
  const names = raw.split(',').map(name => name.trim())
  const invalid = names.filter(name => !ALL_THREAT_CATEGORIES.includes(name as ThreatCategory))
  if (invalid.length > 0) {
    return {
      error: `Unknown categor${invalid.length === 1 ? 'y' : 'ies'}: ${invalid.join(', ')}. Valid categories: ${ALL_THREAT_CATEGORIES.join(', ')}.`,
    }
  }
  return {categories: names as ThreatCategory[]}
}

function buildOptions(args: ParsedArgs): {options: SanitizeOptions} | {error: string} {
  const options: SanitizeOptions = {}
  const replacement = flagAsString(args.flags, 'replacement')
  if (replacement !== undefined) options.replacement = replacement

  const categoriesFlag = flagAsString(args.flags, 'categories')
  if (categoriesFlag !== undefined) {
    const parsed = parseCategories(categoriesFlag)
    if ('error' in parsed) return parsed
    options.categories = parsed.categories
  }

  return {options}
}

export function runSanitize(args: ParsedArgs): CommandResult {
  const [inputPath] = args.positionals
  if (inputPath === undefined) {
    return {exitCode: 2, output: USAGE}
  }

  const write = flagAsBoolean(args.flags, 'write')

  let directory: boolean
  try {
    directory = isDirectory(inputPath)
  } catch (error) {
    return {exitCode: 2, output: `Error: ${error instanceof Error ? error.message : String(error)}`}
  }

  // A directory has no single stdout stream to usefully print multiple
  // files' sanitized content to, so --write is required rather than
  // guessing at some other default.
  if (directory && !write) {
    return {
      exitCode: 2,
      output: 'Error: sanitizing a directory requires --write (there is no single stdout stream for multiple files).',
    }
  }

  const parsedOptions = buildOptions(args)
  if ('error' in parsedOptions) {
    return {exitCode: 2, output: `Error: ${parsedOptions.error}`}
  }
  const {options} = parsedOptions

  let paths: string[]
  let unreadableDirectories: string[]
  try {
    ;({files: paths, unreadableDirectories} = resolveFiles(inputPath))
  } catch (error) {
    return {exitCode: 2, output: `Error: ${error instanceof Error ? error.message : String(error)}`}
  }

  if (!write) {
    // Single file, no --write: print sanitized content to stdout, the
    // sed/prettier convention of a safe, non-destructive default. A single
    // file can never itself contain an unreadable subdirectory.
    const [onlyPath] = paths
    if (onlyPath === undefined) return {exitCode: 0, output: ''}
    const text = readTextFile(onlyPath)
    return {exitCode: 0, output: sanitize(text, options)}
  }

  let changedCount = 0
  const errors: string[] = unreadableDirectories.map(dir => `${dir}: directory could not be read, its contents were not sanitized`)
  for (const path of paths) {
    try {
      const text = readTextFile(path)
      const sanitized = sanitize(text, options)
      if (sanitized !== text) {
        writeFileSync(path, sanitized, 'utf8')
        changedCount++
      }
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const summary = `${changedCount} of ${paths.length} file${paths.length === 1 ? '' : 's'} modified.`
  const output = errors.length > 0 ? [...errors, '', summary].join('\n') : summary
  return {exitCode: errors.length > 0 ? 2 : 0, output}
}
