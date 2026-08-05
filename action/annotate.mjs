#!/usr/bin/env node
// This is the script action.yml's composite step runs. It's plain,
// dependency-free JS rather than the TypeScript everything under src/ uses:
// dist/ is gitignored (only built at publish time), so a script referenced
// by `uses: owner/repo@ref` in a consumer's workflow must already be
// directly executable in the checked-out source, with no build step.
import {execFileSync} from 'node:child_process'
import {appendFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

export const CATEGORY_LABELS = {
  'bidi-embedding': 'bidi embedding/override',
  'bidi-isolate': 'bidi isolate',
  'bidi-mark': 'bidi mark',
  joiner: 'script joiner',
  invisible: 'invisible character',
  tag: 'Unicode tag character',
  'variation-selector': 'variation selector',
  'combining-marks': 'stacked combining marks',
}

// GitHub workflow-command escaping, matching @actions/core's own toolkit
// implementation: data (the part after the final `::`) only needs %, \r, \n
// escaped; property values (the `key=value` pairs before it) additionally
// need : and , escaped, since those are the syntax's own delimiters.
function escapeData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function escapeProperty(value) {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

/** One `::error`/`::warning` annotation line for a single threat, anchored
 *  to the file and 1-based line/column unicode-shield already reports. */
export function threatAnnotation(threat, filePath) {
  const command = threat.severity === 'dangerous' ? 'error' : 'warning'
  const label = CATEGORY_LABELS[threat.category] ?? threat.category
  const codePointHex = `U+${threat.codePoint.toString(16).toUpperCase()}`
  const message = `${threat.name} (${codePointHex}), a ${label} character`
  const properties = [
    `file=${escapeProperty(filePath)}`,
    `line=${threat.line}`,
    `col=${threat.column}`,
    `title=${escapeProperty(`unicode-shield: ${label}`)}`,
  ].join(',')
  return `::${command} ${properties}::${escapeData(message)}`
}

export function unreadableFileAnnotation(filePath, error) {
  return `::warning file=${escapeProperty(filePath)}::unicode-shield could not read this file: ${escapeData(error)}`
}

export function unreadableDirectoryAnnotation(directoryPath) {
  return `::warning::unicode-shield could not read this directory, its contents were not scanned: ${escapeData(directoryPath)}`
}

/**
 * Turns one `unicode-shield scan --json` result (see src/cli/format.ts's
 * formatScanJson for the authoritative shape) into the annotation lines
 * this action should print and the outputs it should expose. Kept free of
 * stdout/env/process.exit so it's directly unit-testable without a real
 * npx call, the same split src/cli/index.ts's run() uses.
 */
export function buildReport(scanResult) {
  const lines = []
  let threatCount = 0

  for (const file of scanResult.files) {
    for (const threat of file.threats) {
      threatCount++
      lines.push(threatAnnotation(threat, file.path))
    }
    if (file.error !== undefined) {
      lines.push(unreadableFileAnnotation(file.path, file.error))
    }
  }
  for (const directoryPath of scanResult.unreadableDirectories) {
    lines.push(unreadableDirectoryAnnotation(directoryPath))
  }

  return {lines, safe: scanResult.safe, threatCount}
}

// Windows ships `npx` as an extensionless POSIX shebang script; only the
// `npx.cmd` wrapper next to it is directly runnable there, and even that
// still needs `shell: true` below, plain execFileSync can't invoke a .cmd
// file at all (a longstanding Node/libuv limitation: a .cmd isn't a real
// PE executable, only cmd.exe can interpret it). Both failure modes were
// confirmed directly against a Windows runner, not assumed.
const NPX_COMMAND = process.platform === 'win32' ? 'npx.cmd' : 'npx'

// `shell: true` is what makes NPX_COMMAND resolve and run on Windows at
// all, see above, and there's no way to avoid it that still supports
// Windows. That makes path and version a real injection surface (both come
// from the consuming workflow's own `with:` inputs) unless validated
// first, which is what the two functions below do.
//
// Both are strict ALLOWLISTS, not denylists, and neither allows |, <, >,
// ^, or space. An earlier version of this file denylisted only the
// "obviously dangerous" characters and allowed |/</> in `version` on the
// reasoning that real npm ranges legitimately use them (`1.x || 2.x`,
// `>=1.0.0 <2.0.0`). That reasoning was wrong: cmd.exe treats |, &, <, >,
// and ^ as live operators EVEN INSIDE double quotes (a well-known cmd.exe
// quirk, quoting there only blocks word-splitting, not operator
// recognition), so any argument containing them is exploitable through
// `shell: true` regardless of surrounding quotes, confirmed directly by
// executing a crafted `version` value that wrote an attacker-chosen file
// to disk. `^` itself was allowed for a while after that fix, on the
// (untested) assumption it'd survive as a literal since it never merges
// arguments or resurrects another operator; a later, real end-to-end run
// (dumping the argv the stubbed npx actually received, not just checking
// the regex) showed cmd.exe consumes `^` as its own escape character
// first and it never reaches npx at all: `^0.7.0` silently becomes
// `0.7.0`, a materially different version, not an error. Not exploitable,
// but not what it claimed to do either, so it's excluded rather than
// documented as "works, but not on Windows". There is no way to keep
// supporting caret/boolean/comparison version ranges here without either
// hand-rolling cmd.exe's escaping rules (its own documented edge cases,
// e.g. around trailing backslashes before a quote, make that easy to get
// subtly wrong, exactly what happened with `^` itself) or adding a
// dependency purely to run one subprocess; narrowing the allowlist
// instead, and accepting that `version` is a plain version, a `~` range,
// or a pre-release/build tag, not a caret or boolean range, is the
// trade-off made here.
const SAFE_VERSION = /^[\w.~+-]+$/

// A version spec beginning with `.` (or `..`) is resolved by npm's own
// package-arg parser as a local directory reference relative to the
// current working directory, entirely independent of the package name
// preceding the `@`, confirmed directly: `unicode-shield@.` runs whatever
// package sits in the working directory instead of the real one. No plain
// version, dist-tag, `~` range, or pre-release/build tag legitimately
// starts with `.`, so this is a pure loss to reject.
const STARTS_WITH_DOT = /^\./

// No leading `-`: unicode-shield's own CLI parses a leading-dash argument
// as a flag (src/cli/args.ts), not a path, so `path: '--json'` would
// reach `unicode-shield scan --json --json` and fail as a usage error
// instead of scanning anything, confirmed directly against parseArgs.
// Low severity (breaks the check, doesn't run anything unintended) but
// cheap to rule out up front with a clearer error than the CLI's own.
const SAFE_PATH = /^[\w./:-]+$/
const STARTS_WITH_DASH = /^-/

// A `..` segment lets `path` walk out of whatever directory a workflow
// author intended to scan. An absolute or drive-letter path (`C:/repo/src`)
// stays allowed, that's the caller's own explicit choice, but nothing
// about a same-repo relative scan target legitimately needs to climb
// upward out of it.
const HAS_DOT_DOT_SEGMENT = /(^|\/)\.\.($|\/)/

function assertSafeVersion(version) {
  if (!SAFE_VERSION.test(version)) {
    throw new Error(
      `version must be a plain version, a ~ range, or a pre-release/build tag (letters, digits, . ~ + - only), got: ${JSON.stringify(version)}`,
    )
  }
  if (STARTS_WITH_DOT.test(version)) {
    throw new Error(
      `version must not start with '.', npm resolves that as a local directory instead of a registry version, got: ${JSON.stringify(version)}`,
    )
  }
}

function assertSafePath(path) {
  if (!SAFE_PATH.test(path)) {
    throw new Error(`path contains characters this action doesn't accept (letters, digits, . / : - only), got: ${JSON.stringify(path)}`)
  }
  if (STARTS_WITH_DASH.test(path)) {
    throw new Error(`path must not start with '-', it would be parsed as a flag rather than a path, got: ${JSON.stringify(path)}`)
  }
  if (HAS_DOT_DOT_SEGMENT.test(path)) {
    throw new Error(`path must not contain a '..' segment, got: ${JSON.stringify(path)}`)
  }
}

/**
 * Runs `npx unicode-shield@version scan path --json`.
 *
 * scan's own exit code 1 ("threats found") is an expected outcome that
 * still carries JSON on stdout, execFileSync throws for it regardless (any
 * non-zero exit does), so that JSON is recovered from the error object
 * rather than treated as a failure. Exit code 2 ("usage/runtime error")
 * writes a plain-text message instead, not JSON; buildReport()'s caller
 * handles that by catching the resulting JSON.parse failure, not by
 * inspecting the exit code here.
 */
function runScanJson(path, version) {
  assertSafePath(path)
  assertSafeVersion(version)
  try {
    return execFileSync(NPX_COMMAND, ['--yes', `unicode-shield@${version}`, 'scan', path, '--json'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
      shell: true,
    })
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.length > 0) return error.stdout
    throw error
  }
}

function writeOutput(name, value, env) {
  const outputFile = env.GITHUB_OUTPUT
  if (!outputFile) return
  appendFileSync(outputFile, `${name}=${value}\n`)
}

/**
 * Reads the action's inputs from `env` (GitHub passes composite-action
 * inputs as INPUT_* environment variables) rather than process.env
 * directly, so tests can inject a plain object instead of mutating global
 * state. The real entry point below still defaults to process.env.
 */
export function main(env = process.env) {
  const path = env.INPUT_PATH || '.'
  const version = env.INPUT_VERSION || 'latest'
  const failOnThreat = (env.INPUT_FAIL_ON_THREAT ?? 'true') !== 'false'

  let stdout
  try {
    stdout = runScanJson(path, version)
  } catch (error) {
    console.log(`::error::unicode-shield failed to run: ${escapeData(error.message ?? String(error))}`)
    process.exitCode = 1
    return
  }

  let scanResult
  try {
    scanResult = JSON.parse(stdout)
  } catch {
    console.log(`::error::unicode-shield did not produce valid JSON output. Raw output: ${escapeData(stdout.trim())}`)
    process.exitCode = 1
    return
  }

  const {lines, safe, threatCount} = buildReport(scanResult)
  for (const line of lines) console.log(line)

  writeOutput('safe', String(safe), env)
  writeOutput('threat-count', String(threatCount), env)

  if (!safe && failOnThreat) {
    process.exitCode = 1
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main()
}
