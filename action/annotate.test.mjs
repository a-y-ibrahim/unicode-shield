import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// spawnSync is mocked so these tests never actually shell out to npx;
// appendFileSync is left real (routed at a real temp file below) so the
// GITHUB_OUTPUT-writing path is exercised end to end, not just asserted
// against a spy. Same vi.hoisted() indirection this project's CLI tests
// already use for node:fs, native ESM module namespaces can't be
// redefined with vi.spyOn directly.
//
// Each test's impl returns a plain {status, stdout, stderr, error?}
// object, the same shape the real spawnSync returns unconditionally
// (unlike execFileSync, which this file used previously: it only returns
// stdout on success and only exposes stderr via a thrown Error's property
// on a non-zero exit, discarding it entirely otherwise, see the comment
// on runScan in annotate.mjs for why that distinction mattered for real).
const spawnSyncTrigger = vi.hoisted(() => ({
  impl: () => {
    throw new Error('spawnSyncTrigger.impl not set for this test')
  },
}))

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawnSync: (command, args, options) => spawnSyncTrigger.impl(command, args, options),
  }
})

const {buildReport, main, threatAnnotation, unreadableDirectoryAnnotation, unreadableFileAnnotation} = await import(
  './annotate.mjs'
)

// Built via String.fromCodePoint(), not typed literally: this project's own
// convention for any real bidi/invisible character appearing in source, so
// nothing here is a literal, hard-to-review control character in an editor.
const RLO = String.fromCodePoint(0x202e)
const NEWLINE = String.fromCharCode(10)

function threat(overrides = {}) {
  return {
    category: 'bidi-embedding',
    severity: 'dangerous',
    char: RLO,
    codePoint: 0x202e,
    index: 5,
    name: 'RIGHT-TO-LEFT OVERRIDE',
    line: 1,
    column: 6,
    ...overrides,
  }
}

/** A successful spawnSync result carrying `stdout` on exit code `status` (0 clean, 1 threats found, both real report content). */
function spawnResult(status, stdout, stderr = '') {
  return {status, stdout, stderr, error: undefined, signal: null}
}

/** A spawnSync result for the process never starting at all (npx missing, a permissions error, ...): no stdout/stderr, `error` set. */
function spawnFailure(message) {
  return {status: null, stdout: null, stderr: null, signal: null, error: new Error(message)}
}

describe('threatAnnotation', () => {
  it('emits an error command for a dangerous threat', () => {
    const line = threatAnnotation(threat(), 'src/app.ts')
    expect(line).toBe(
      '::error file=src/app.ts,line=1,col=6,title=unicode-shield%3A bidi embedding/override::RIGHT-TO-LEFT OVERRIDE (U+202E), a bidi embedding/override character',
    )
  })

  it('emits a warning command for an informational threat', () => {
    const line = threatAnnotation(threat({severity: 'informational', category: 'bidi-mark'}), 'src/app.ts')
    expect(line.startsWith('::warning ')).toBe(true)
  })

  it('falls back to the raw category string for an unrecognized category', () => {
    const line = threatAnnotation(threat({category: 'future-category'}), 'src/app.ts')
    expect(line).toContain('a future-category character')
  })

  it.each([
    ['invisible', 'an invisible character'],
    ['tag', 'a Unicode tag character'],
    ['combining-marks', 'an excessively stacked combining mark'],
  ])(
    'phrases the %s category as a single, grammatically correct noun phrase, not "character character" or a plural mismatch',
    (category, expectedPhrase) => {
      const line = threatAnnotation(threat({category}), 'src/app.ts')
      expect(line).toContain(expectedPhrase)
      expect(line).not.toContain('character character')
    },
  )

  it('escapes % : , and newlines in the file path property', () => {
    const line = threatAnnotation(threat(), `weird,path%with:chars${NEWLINE}here`)
    expect(line).toContain('file=weird%2Cpath%25with%3Achars%0Ahere,')
  })

  it('escapes newlines in the message data', () => {
    const line = threatAnnotation(threat({name: `A${NEWLINE}B`}), 'f.ts')
    expect(line).toContain('::A%0AB (U+202E)')
  })
})

describe('unreadableFileAnnotation and unreadableDirectoryAnnotation', () => {
  it('formats an unreadable file as a warning naming the file', () => {
    expect(unreadableFileAnnotation('secret.bin', 'EACCES')).toBe(
      '::warning file=secret.bin::unicode-shield could not read this file: EACCES',
    )
  })

  it('formats an unreadable directory as a warning', () => {
    expect(unreadableDirectoryAnnotation('node_modules/broken')).toBe(
      '::warning::unicode-shield could not read this directory, its contents were not scanned: node_modules/broken',
    )
  })
})

describe('buildReport', () => {
  it('aggregates threats and counts them across multiple files', () => {
    const report = buildReport({
      safe: false,
      files: [
        {path: 'a.ts', safe: false, threats: [threat(), threat({column: 10})]},
        {path: 'b.ts', safe: true, threats: []},
      ],
      unreadableDirectories: [],
    })
    expect(report.threatCount).toBe(2)
    expect(report.safe).toBe(false)
    expect(report.lines).toHaveLength(2)
  })

  it('includes a warning line for each per-file read error', () => {
    const report = buildReport({
      safe: true,
      files: [{path: 'locked.ts', safe: true, threats: [], error: 'EACCES'}],
      unreadableDirectories: [],
    })
    expect(report.lines).toEqual([unreadableFileAnnotation('locked.ts', 'EACCES')])
  })

  it('includes a warning line for each unreadable directory', () => {
    const report = buildReport({safe: true, files: [], unreadableDirectories: ['dist', 'vendor']})
    expect(report.lines).toEqual([unreadableDirectoryAnnotation('dist'), unreadableDirectoryAnnotation('vendor')])
  })

  it('passes safe through unchanged when there is nothing to report', () => {
    expect(buildReport({safe: true, files: [], unreadableDirectories: []})).toEqual({
      lines: [],
      safe: true,
      threatCount: 0,
    })
  })
})

describe('main', () => {
  let outputFile
  let consoleLogSpy

  beforeEach(() => {
    outputFile = join(mkdtempSync(join(tmpdir(), 'unicode-shield-action-test-')), 'github_output')
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = undefined
  })

  afterEach(() => {
    rmSync(outputFile, {force: true})
    consoleLogSpy.mockRestore()
    process.exitCode = undefined
  })

  function readOutputs() {
    return readFileSync(outputFile, 'utf8')
  }

  it('reports safe=true and does not fail the step on a clean scan', () => {
    spawnSyncTrigger.impl = () => spawnResult(0, JSON.stringify({safe: true, filesScanned: 2, files: [], unreadableDirectories: []}))

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBeUndefined()
    expect(readOutputs()).toBe(`safe=true${NEWLINE}threat-count=0${NEWLINE}`)
    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  it('prints annotations, reports safe=false, and fails the step when a threat is found', () => {
    spawnSyncTrigger.impl = () =>
      spawnResult(
        1,
        JSON.stringify({
          safe: false,
          filesScanned: 1,
          files: [{path: 'a.ts', safe: false, threats: [threat()]}],
          unreadableDirectories: [],
        }),
      )

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(readOutputs()).toBe(`safe=false${NEWLINE}threat-count=1${NEWLINE}`)
    expect(consoleLogSpy).toHaveBeenCalledWith(threatAnnotation(threat(), 'a.ts'))
  })

  it('does not fail the step when fail-on-threat is false, even with a threat found', () => {
    spawnSyncTrigger.impl = () =>
      spawnResult(
        1,
        JSON.stringify({
          safe: false,
          filesScanned: 1,
          files: [{path: 'a.ts', safe: false, threats: [threat()]}],
          unreadableDirectories: [],
        }),
      )

    main({GITHUB_OUTPUT: outputFile, INPUT_FAIL_ON_THREAT: 'false'})

    expect(process.exitCode).toBeUndefined()
    expect(readOutputs()).toBe(`safe=false${NEWLINE}threat-count=1${NEWLINE}`)
  })

  it('fails the step with a rich annotation, including stderr, when the CLI exits with a usage error', () => {
    // src/cli/index.ts writes exit-code-2 output via console.error (to
    // stderr, not stdout), so the real failure shape here is empty stdout
    // plus a message on stderr. spawnSync returns both unconditionally,
    // regardless of exit code, unlike execFileSync (used here previously),
    // which only ever exposed stderr on a *thrown* error and discarded it
    // completely for a clean exit; the stderr content below is exactly
    // the kind of detail that distinction was hiding, confirmed for real
    // against an actual 0-exit-with-empty-stdout failure on CI.
    spawnSyncTrigger.impl = () => spawnResult(2, '', 'Error: ENOENT: no such file or directory')

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('did not produce the expected JSON output'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('exit code 2'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Error: ENOENT: no such file or directory'))
  })

  it('fails the step with a rich annotation when stdout has unexpected, non-JSON content on a clean exit', () => {
    // A different scenario from the one above: the process exits 0 with
    // empty stderr, but what it printed to stdout isn't valid JSON. This
    // is the exact shape a real, confirmed CI failure took (see the
    // comment on runScan in annotate.mjs): a 0 exit, no stderr, and stdout
    // that wasn't the expected report, previously indistinguishable from
    // "worked fine" under execFileSync since it never threw for this case.
    spawnSyncTrigger.impl = () => spawnResult(0, `npm warn using --force${NEWLINE}not json`)

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('did not produce the expected JSON output'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('exit code 0'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('stderr was empty'))
  })

  it('fails the step with a clear annotation when npx itself cannot run at all', () => {
    spawnSyncTrigger.impl = () => spawnFailure('spawnSync npx ENOENT')

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('unicode-shield failed to run'))
  })

  it('passes path and version through to the npx invocation, via a shell', () => {
    let capturedArgs
    let capturedOptions
    spawnSyncTrigger.impl = (_command, args, options) => {
      capturedArgs = args
      capturedOptions = options
      return spawnResult(0, JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []}))
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: 'src', INPUT_VERSION: '0.7.0'})

    expect(capturedArgs).toEqual(['--yes', 'unicode-shield@0.7.0', 'scan', 'src', '--json'])
    // shell: true is required on Windows to run the npx.cmd wrapper at
    // all (confirmed directly, see the comment in annotate.mjs), which is
    // exactly why path/version are validated first rather than passed
    // through unchecked.
    expect(capturedOptions.shell).toBe(true)
  })

  it('defaults to scanning "." at the latest version when no inputs are given', () => {
    let capturedArgs
    spawnSyncTrigger.impl = (_command, args) => {
      capturedArgs = args
      return spawnResult(0, JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []}))
    }

    main({GITHUB_OUTPUT: outputFile})

    expect(capturedArgs).toEqual(['--yes', 'unicode-shield@latest', 'scan', '.', '--json'])
  })

  it('does not write outputs when GITHUB_OUTPUT is not set (e.g. running outside Actions)', () => {
    spawnSyncTrigger.impl = () => spawnResult(0, JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []}))

    expect(() => main({})).not.toThrow()
  })

  it.each([
    ['a semicolon', 'src; rm -rf /'],
    ['a redirect, the exact independent-review finding', 'x>REDIRECT_MARKER.txt'],
    ['a pipe', 'src | evil'],
    ['a space', 'my project/src'],
    ['a backtick', 'src`evil`'],
    ['a dollar sign', 'src$(evil)'],
  ])('rejects a path containing %s instead of ever reaching the shell', (_label, path) => {
    spawnSyncTrigger.impl = () => {
      throw new Error('should not have been called')
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: path})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("path contains characters this action doesn't accept"))
  })

  it.each([
    ['a plain version', '0.7.0'],
    ['a tilde range', '~0.7.0'],
    ['a pre-release tag', '0.7.0-beta.1'],
    ['a build-metadata tag', '0.7.0+build.1'],
    ['the default', 'latest'],
  ])('accepts %s as a version', (_label, version) => {
    spawnSyncTrigger.impl = () => spawnResult(0, JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []}))

    main({GITHUB_OUTPUT: outputFile, INPUT_VERSION: version})

    expect(process.exitCode).toBeUndefined()
  })

  it.each([
    ['a plain relative path', 'src'],
    ['a nested path', 'src/cli/commands'],
    ['a Windows-style path with a drive letter', 'C:/repo/src'],
    ['the default', '.'],
  ])('accepts %s as a path', (_label, path) => {
    spawnSyncTrigger.impl = () => spawnResult(0, JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []}))

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: path})

    expect(process.exitCode).toBeUndefined()
  })

  it('rejects a path starting with a dash instead of letting it be parsed as a CLI flag', () => {
    spawnSyncTrigger.impl = () => {
      throw new Error('should not have been called')
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: '--json'})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("path must not start with '-'"))
  })

  it.each([
    ['a leading .. segment', '../../etc/passwd'],
    ['a trailing .. segment', 'src/..'],
    ['a .. segment in the middle', 'src/../../secrets'],
    ['bare ..', '..'],
  ])('rejects a path containing %s instead of letting it escape the intended directory', (_label, path) => {
    spawnSyncTrigger.impl = () => {
      throw new Error('should not have been called')
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: path})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("path must not contain a '..' segment"))
  })

  it.each([
    ['a semicolon', 'latest; evil'],
    ['a pipe, the exact independent-review finding', `0.7.0|echo INJECTED>PIPE_INJECTION_MARKER.txt`],
    ['a boolean OR range (no longer supported, see the comment above SAFE_VERSION)', '1.x || 2.x'],
    ['a comparison range (same reason)', '>=1.0.0 <2.0.0'],
    [
      'a caret range (no longer supported: confirmed cmd.exe silently strips ^ rather than passing it through)',
      '^0.7.0',
    ],
    ['a backtick', 'latest`evil`'],
  ])('rejects a version containing %s instead of ever reaching the shell', (_label, version) => {
    spawnSyncTrigger.impl = () => {
      throw new Error('should not have been called')
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_VERSION: version})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('version must be a plain version'),
    )
  })

  it.each([
    ['a bare dot, the exact independent-review finding: npm resolves this as a local directory install', '.'],
    ['a bare double dot', '..'],
    ['a dot-prefixed value', '.foo'],
  ])('rejects a version starting with %s instead of letting npm resolve it as a local directory', (_label, version) => {
    spawnSyncTrigger.impl = () => {
      throw new Error('should not have been called')
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_VERSION: version})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("version must not start with '.'"))
  })

  describe('sarif', () => {
    const CLEAN_JSON = JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []})
    const FAKE_SARIF = JSON.stringify({version: '2.1.0', runs: [{tool: {driver: {name: 'unicode-shield'}}, results: []}]})

    let runnerTemp

    beforeEach(() => {
      runnerTemp = mkdtempSync(join(tmpdir(), 'unicode-shield-action-sarif-test-'))
    })

    afterEach(() => {
      rmSync(runnerTemp, {recursive: true, force: true})
    })

    // Distinguishes the two real invocations by their own argv (the JSON
    // call ends in the literal --json flag; the SARIF call ends in
    // --format sarif, see the comments on runScanJson/runScanSarif in
    // annotate.mjs for why they aren't the same flag), the same signal a
    // real npx call would carry, rather than call order (order is an
    // implementation detail main() shouldn't be pinned to).
    function dualFormatImpl({jsonResult, sarifResult}) {
      return (_command, args) => {
        if (args.at(-1) === '--json') return jsonResult
        if (args.at(-1) === 'sarif') return sarifResult
        throw new Error(`unexpected args in test double: ${JSON.stringify(args)}`)
      }
    }

    it('writes a real SARIF file and sets sarif-path when sarif is true', () => {
      spawnSyncTrigger.impl = dualFormatImpl({jsonResult: spawnResult(0, CLEAN_JSON), sarifResult: spawnResult(0, FAKE_SARIF)})

      main({GITHUB_OUTPUT: outputFile, RUNNER_TEMP: runnerTemp, INPUT_SARIF: 'true'})

      const outputs = readOutputs()
      const sarifPathLine = outputs.split(NEWLINE).find(line => line.startsWith('sarif-path='))
      expect(sarifPathLine).toBeDefined()
      const sarifPath = sarifPathLine.slice('sarif-path='.length)
      expect(readFileSync(sarifPath, 'utf8')).toBe(FAKE_SARIF)
    })

    it('defaults the SARIF file location under RUNNER_TEMP', () => {
      spawnSyncTrigger.impl = dualFormatImpl({jsonResult: spawnResult(0, CLEAN_JSON), sarifResult: spawnResult(0, FAKE_SARIF)})

      main({GITHUB_OUTPUT: outputFile, RUNNER_TEMP: runnerTemp, INPUT_SARIF: 'true'})

      const outputs = readOutputs()
      const sarifPath = outputs.split(NEWLINE).find(line => line.startsWith('sarif-path=')).slice('sarif-path='.length)
      expect(sarifPath.startsWith(runnerTemp)).toBe(true)
    })

    it('does not attempt a second invocation at all when sarif is not requested (the default)', () => {
      let callCount = 0
      spawnSyncTrigger.impl = (...args) => {
        callCount++
        return dualFormatImpl({jsonResult: spawnResult(0, CLEAN_JSON), sarifResult: spawnResult(0, FAKE_SARIF)})(...args)
      }

      main({GITHUB_OUTPUT: outputFile, RUNNER_TEMP: runnerTemp})

      expect(callCount).toBe(1)
      expect(readOutputs()).not.toContain('sarif-path=')
    })

    it('passes the same path and version to the SARIF invocation as the JSON one', () => {
      let sarifArgs
      spawnSyncTrigger.impl = (command, args) => {
        if (args.at(-1) === '--json') return spawnResult(0, CLEAN_JSON)
        sarifArgs = args
        return spawnResult(0, FAKE_SARIF)
      }

      main({GITHUB_OUTPUT: outputFile, RUNNER_TEMP: runnerTemp, INPUT_SARIF: 'true', INPUT_PATH: 'src', INPUT_VERSION: '0.7.0'})

      expect(sarifArgs).toEqual(['--yes', 'unicode-shield@0.7.0', 'scan', 'src', '--format', 'sarif'])
    })

    it('warns but does not fail the step when SARIF generation fails to even start, even though the main scan already succeeded', () => {
      spawnSyncTrigger.impl = (_command, args) => {
        if (args.at(-1) === '--json') return spawnResult(0, CLEAN_JSON)
        return spawnFailure('npx ENOENT for the sarif invocation')
      }

      main({GITHUB_OUTPUT: outputFile, RUNNER_TEMP: runnerTemp, INPUT_SARIF: 'true'})

      expect(process.exitCode).toBeUndefined()
      expect(readOutputs()).toBe(`safe=true${NEWLINE}threat-count=0${NEWLINE}`)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('::warning::'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('could not produce a SARIF report'))
    })

    it('warns but does not fail the step when SARIF generation runs but produces unexpected, non-JSON output', () => {
      // A different failure mode from the one above: the sarif invocation
      // itself starts and exits, but what it printed isn't valid JSON,
      // the exact class of bug this whole rewrite exists to make
      // diagnosable (see runScan's own comment in annotate.mjs).
      spawnSyncTrigger.impl = (_command, args) => {
        if (args.at(-1) === '--json') return spawnResult(0, CLEAN_JSON)
        return spawnResult(0, '')
      }

      main({GITHUB_OUTPUT: outputFile, RUNNER_TEMP: runnerTemp, INPUT_SARIF: 'true'})

      expect(process.exitCode).toBeUndefined()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('could not produce a SARIF report'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('did not produce the expected SARIF output'))
    })

    it('still fails before ever attempting the SARIF invocation when path is invalid, sarif: true or not', () => {
      let sarifCalled = false
      spawnSyncTrigger.impl = (_command, args) => {
        if (args.at(-1) === 'sarif') sarifCalled = true
        throw new Error('should not have been called')
      }

      main({GITHUB_OUTPUT: outputFile, RUNNER_TEMP: runnerTemp, INPUT_SARIF: 'true', INPUT_PATH: 'src; rm -rf /'})

      expect(process.exitCode).toBe(1)
      expect(sarifCalled).toBe(false)
    })
  })
})
