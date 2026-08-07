#!/usr/bin/env node
// This is the script action.yml's composite step runs. It's plain,
// dependency-free JS rather than the TypeScript everything under src/ uses:
// dist/ is gitignored (only built at publish time), so a script referenced
// by `uses: owner/repo@ref` in a consumer's workflow must already be
// directly executable in the checked-out source, with no build step.
import {spawnSync} from 'node:child_process'
import {appendFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
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

// The message body's own complete noun phrase per category, kept separate
// from CATEGORY_LABELS (a short tag, used only in the `title=` property)
// rather than derived from it by mechanically gluing on "a"/"an" and
// "character": that mechanical approach silently duplicated the word
// "character" for a category whose own label already ends in it
// ('invisible character', 'Unicode tag character' above both become
// "a ... character character"), and produced a singular/plural mismatch
// for combining-marks ("a stacked combining marks character").
const CATEGORY_MESSAGE_PHRASES = {
  'bidi-embedding': 'a bidi embedding/override character',
  'bidi-isolate': 'a bidi isolate character',
  'bidi-mark': 'a bidi mark character',
  joiner: 'a script joiner character',
  invisible: 'an invisible character',
  tag: 'a Unicode tag character',
  'variation-selector': 'a variation selector character',
  'combining-marks': 'an excessively stacked combining mark',
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
  const phrase = CATEGORY_MESSAGE_PHRASES[threat.category] ?? `a ${threat.category} character`
  const codePointHex = `U+${threat.codePoint.toString(16).toUpperCase()}`
  const message = `${threat.name} (${codePointHex}), ${phrase}`
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
// still needs `shell: true` below, plain spawnSync can't invoke a .cmd
// file at all (a longstanding Node/libuv limitation, shared by every
// child_process spawn variant: a .cmd isn't a real PE executable, only
// cmd.exe can interpret it). Both failure modes were confirmed directly
// against a Windows runner, not assumed.
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
 * Runs `npx unicode-shield@version scan path <...extraArgs>` and returns
 * the full spawnSync result (status, stdout, stderr), not just stdout on
 * success: execFileSync (used here previously) only exposes stderr at all
 * when the process exits non-zero, and only exposes stdout via a thrown
 * Error's `.stdout` property in that same case, discarding it entirely on
 * a genuine, unrelated crash. That's exactly the wrong shape for
 * diagnosing "the process exited 0 but printed something other than the
 * expected report": under execFileSync that case is indistinguishable
 * from "worked fine, just isn't JSON", with no stderr to explain why,
 * since a 0 exit never populates `error.stderr`. spawnSync returns
 * stdout/stderr unconditionally regardless of exit code, so the caller
 * can build a real diagnostic instead of guessing. Confirmed this
 * mattered directly: a self-test run on Linux/macOS runners exited 0 with
 * empty stdout, and execFileSync's shape had no way to surface whatever
 * npx itself had written to stderr that would have explained it.
 *
 * spawnSync itself never throws for a non-zero exit (unlike execFileSync);
 * it only sets `result.error` when the process couldn't be started at all
 * (npx missing, a permissions error, ...), which is the one case this
 * re-throws for, since there's no stdout/stderr to report in that case
 * either. Interpreting `result.status` (0 clean, 1 threats found, both
 * carrying a real report; anything else doesn't) is left to the caller.
 */
function runScan(path, version, extraArgs) {
  assertSafePath(path)
  assertSafeVersion(version)
  const result = spawnSync(NPX_COMMAND, ['--yes', `unicode-shield@${version}`, 'scan', path, ...extraArgs], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    shell: true,
  })
  if (result.error) throw result.error
  return result
}

// `--json`, not `--format json`, deliberately: `version` is a
// user-configurable input specifically so a workflow CAN pin to an older
// published unicode-shield release, and every version ever published
// understands `--json`. `--format` is new (introduced alongside SARIF
// support) and isn't in any released version as of this action's own
// release; hard-requiring it here would silently break the core
// annotation flow (the one thing every consumer of this action depends
// on, sarif: true or not) for anyone on an older version or the default
// `latest` before a version with --format support is actually published.
// Confirmed directly: pointed this at the real, currently-published
// `latest`, and a `--format json` call silently fell back to
// human-readable output instead of erroring, since the old CLI simply
// doesn't recognize the flag. --format is fine to require for
// runScanSarif below, since SARIF is a brand new capability with no
// backward-compatibility expectation to begin with.
function runScanJson(path, version) {
  return runScan(path, version, ['--json'])
}

/**
 * A second, separate invocation from runScanJson's rather than one call
 * producing both formats at once: this always derives SARIF from the
 * exact same, single canonical formatter (src/cli/sarif.ts, via the
 * published CLI), instead of this plain-JS script maintaining its own
 * parallel copy of the SARIF rule table that would silently drift out of
 * sync the next time a threat category is added there. Only called at all
 * when the `sarif` input is truthy, so the common case (annotations only)
 * pays no extra cost.
 */
function runScanSarif(path, version) {
  return runScan(path, version, ['--format', 'sarif'])
}

/**
 * A diagnostic message for when unicode-shield's own stdout wasn't the
 * report it was supposed to be: the exit status (or the signal that
 * killed it, if any), whatever stderr the process wrote (frequently the
 * actual explanation, see runScan's own comment on why that's not
 * discarded here), and stdout itself. All three, not just "here's the raw
 * output", specifically because a 0-exit-with-empty-stdout failure (a real
 * one, not hypothetical, see runScan) looks identical to a crash without
 * this: this is what turns that into something actually diagnosable
 * instead of a dead end.
 */
function unexpectedOutputMessage(label, result) {
  const exitInfo = result.status !== null ? `exit code ${result.status}` : `killed by signal ${result.signal}`
  const stderr = (result.stderr ?? '').trim()
  const stdout = (result.stdout ?? '').trim()
  return [
    `unicode-shield did not produce the expected ${label} output (${exitInfo}).`,
    stderr.length > 0 ? `stderr: ${stderr}` : 'stderr was empty.',
    stdout.length > 0 ? `stdout: ${stdout}` : 'stdout was empty.',
  ].join(' ')
}

// RUNNER_TEMP (set by every GitHub-hosted and self-hosted runner) rather
// than the checked-out working directory: this file is scratch output for
// the next step (upload-sarif) to consume, not part of the repository, and
// writing it into the checkout risks a later step that runs `git status`
// or similar seeing an unexpected untracked file. Falls back to Node's own
// tmpdir() so main() still works outside real GitHub Actions (tests, local
// runs).
function sarifFilePath(env) {
  return join(env.RUNNER_TEMP || tmpdir(), 'unicode-shield.sarif.json')
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
  const wantSarif = env.INPUT_SARIF === 'true'

  let result
  try {
    result = runScanJson(path, version)
  } catch (error) {
    console.log(`::error::unicode-shield failed to run: ${escapeData(error.message ?? String(error))}`)
    process.exitCode = 1
    return
  }

  let scanResult
  try {
    scanResult = JSON.parse(result.stdout)
  } catch {
    console.log(`::error::${escapeData(unexpectedOutputMessage('JSON', result))}`)
    process.exitCode = 1
    return
  }

  const {lines, safe, threatCount} = buildReport(scanResult)
  for (const line of lines) console.log(line)

  writeOutput('safe', String(safe), env)
  writeOutput('threat-count', String(threatCount), env)

  // A SARIF-generation failure only loses the optional Code Scanning
  // upload for this run; the annotations and outputs above already
  // succeeded, the thing every consumer of this action depends on, so
  // this is a warning rather than something that fails the whole step.
  if (wantSarif) {
    try {
      const sarifResult = runScanSarif(path, version)
      try {
        JSON.parse(sarifResult.stdout) // validate before trusting it, not just forwarding it
      } catch {
        throw new Error(unexpectedOutputMessage('SARIF', sarifResult))
      }
      const outputPath = sarifFilePath(env)
      writeFileSync(outputPath, sarifResult.stdout)
      writeOutput('sarif-path', outputPath, env)
    } catch (error) {
      console.log(`::warning::unicode-shield could not produce a SARIF report: ${escapeData(error.message ?? String(error))}`)
    }
  }

  if (!safe && failOnThreat) {
    process.exitCode = 1
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main()
}
