#!/usr/bin/env node
import {pathToFileURL} from 'node:url'

import {parseArgs} from './args'
import {runCompare} from './commands/compare'
import {runSanitize} from './commands/sanitize'
import {runScan} from './commands/scan'
import type {CommandResult} from './types'
import {getPackageVersion} from './version'

const HELP_TEXT = `unicode-shield <command> [options]

Detect and sanitize dangerous Unicode: bidi spoofing, invisible characters,
Zalgo-style combining-mark stacking, and visually confusable characters.

Commands:
  scan <path>          Scan a file, directory, or - for stdin, for threats
  sanitize <path>       Strip dangerous characters from a file, directory, or -
  compare <a> <b>        Check whether two strings are visually confusable

Options:
  --json                 Machine-readable JSON output (scan, compare)
  --format <name>          human (default), json, or sarif (scan only)
  --write                    Modify files in place (sanitize, not with -)
  --replacement <str>          Substitute string instead of deleting (sanitize)
  --categories <a,b,c>            Also strip these categories (sanitize)
  --help, -h                        Show this help
  --version, -v                       Show the installed version

Examples:
  unicode-shield scan ./src
  unicode-shield scan file.txt --json
  unicode-shield scan ./src --format sarif > results.sarif
  unicode-shield sanitize file.txt > clean.txt
  unicode-shield sanitize ./data --write
  unicode-shield compare "apple" "аpple"
  cat file.txt | unicode-shield scan -
  some-tool | unicode-shield sanitize - | another-tool

Exit codes: 0 clean, 1 threat or confusable pair found, 2 usage or runtime error.`

/**
 * Parses argv (already sliced past `node cli.js`) and runs the matching
 * command, without touching stdout or process.exit(): that separation is
 * what makes this directly unit-testable, see __tests__/cli/index.test.ts.
 */
export function run(argv: string[]): CommandResult {
  const [command, ...rest] = argv

  if (command === undefined || command === '--help' || command === '-h') {
    return {exitCode: 0, output: HELP_TEXT}
  }
  if (command === '--version' || command === '-v') {
    return {exitCode: 0, output: getPackageVersion(import.meta.url)}
  }

  const args = parseArgs(rest)

  switch (command) {
    case 'scan':
      return runScan(args)
    case 'sanitize':
      return runSanitize(args)
    case 'compare':
      return runCompare(args)
    default:
      return {exitCode: 2, output: `Unknown command: ${command}\n\n${HELP_TEXT}`}
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const {exitCode, output} = run(process.argv.slice(2))
  if (output.length > 0) {
    if (exitCode === 2) console.error(output)
    else console.log(output)
  }
  // Sets the exit code for Node to use once it exits naturally, rather
  // than calling process.exit(exitCode) directly: on Linux and macOS,
  // stdout is a non-blocking pipe when captured by another process (a
  // shell redirect, or exactly the child_process capture a script or CI
  // step invoking this CLI does), so a write from the console.log above
  // can still be in flight when process.exit() would tear the process
  // down, silently dropping some or all of that output; confirmed
  // directly against a real GitHub Actions Linux/macOS runner, where a
  // clean scan's own JSON output was lost entirely this way (exit code 0,
  // completely empty stdout), a well-documented Node.js gotcha, not
  // specific to this codebase. process.exitCode alone lets the event
  // loop drain (including that pending write) before Node exits on its
  // own once nothing else is scheduled.
  process.exitCode = exitCode
}
