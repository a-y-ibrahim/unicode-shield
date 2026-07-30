import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// execFileSync is mocked so these tests never actually shell out to npx;
// appendFileSync is left real (routed at a real temp file below) so the
// GITHUB_OUTPUT-writing path is exercised end to end, not just asserted
// against a spy. Same vi.hoisted() indirection this project's CLI tests
// already use for node:fs, native ESM module namespaces can't be
// redefined with vi.spyOn directly.
const execFileSyncTrigger = vi.hoisted(() => ({
  impl: () => {
    throw new Error('execFileSyncTrigger.impl not set for this test')
  },
}))

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    execFileSync: (command, args, options) => execFileSyncTrigger.impl(command, args, options),
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
    execFileSyncTrigger.impl = () => JSON.stringify({safe: true, filesScanned: 2, files: [], unreadableDirectories: []})

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBeUndefined()
    expect(readOutputs()).toBe(`safe=true${NEWLINE}threat-count=0${NEWLINE}`)
    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  it('prints annotations, reports safe=false, and fails the step when a threat is found', () => {
    execFileSyncTrigger.impl = () => {
      const error = new Error('Command failed')
      error.status = 1
      error.stdout = JSON.stringify({
        safe: false,
        filesScanned: 1,
        files: [{path: 'a.ts', safe: false, threats: [threat()]}],
        unreadableDirectories: [],
      })
      throw error
    }

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(readOutputs()).toBe(`safe=false${NEWLINE}threat-count=1${NEWLINE}`)
    expect(consoleLogSpy).toHaveBeenCalledWith(threatAnnotation(threat(), 'a.ts'))
  })

  it('does not fail the step when fail-on-threat is false, even with a threat found', () => {
    execFileSyncTrigger.impl = () => {
      const error = new Error('Command failed')
      error.status = 1
      error.stdout = JSON.stringify({
        safe: false,
        filesScanned: 1,
        files: [{path: 'a.ts', safe: false, threats: [threat()]}],
        unreadableDirectories: [],
      })
      throw error
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_FAIL_ON_THREAT: 'false'})

    expect(process.exitCode).toBeUndefined()
    expect(readOutputs()).toBe(`safe=false${NEWLINE}threat-count=1${NEWLINE}`)
  })

  it('fails the step with a clear annotation when the CLI exits with a usage error (message on stderr, not stdout)', () => {
    // src/cli/index.ts writes exit-code-2 output via console.error, so the
    // real failure shape here is empty stdout plus a message on stderr,
    // not stdout containing the plain-text error (that would be a
    // different, separately-tested scenario, see the "unexpected content
    // on stdout" case below). execFileSync's error carries an empty
    // string for a stream that produced no output, not undefined.
    execFileSyncTrigger.impl = () => {
      const error = new Error('Command failed')
      error.status = 2
      error.stdout = ''
      error.stderr = 'Error: ENOENT: no such file or directory'
      throw error
    }

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('unicode-shield failed to run'))
  })

  it('fails the step with a clear annotation when stdout has unexpected, non-JSON content', () => {
    // A different scenario from the one above: the process exits 0 (or
    // its stdout is otherwise non-empty) but what it printed isn't valid
    // JSON, e.g. npx itself writing a status line to stdout instead of
    // stderr in some environment. Exercises JSON.parse's own catch branch
    // in main(), distinct from runScanJson's error-recovery branch.
    execFileSyncTrigger.impl = () => `npm warn using --force${NEWLINE}not json`

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('::error::'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('did not produce valid JSON'))
  })

  it('fails the step with a clear annotation when npx itself cannot run at all', () => {
    execFileSyncTrigger.impl = () => {
      throw new Error('spawnSync npx ENOENT')
    }

    main({GITHUB_OUTPUT: outputFile})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('unicode-shield failed to run'))
  })

  it('passes path and version through to the npx invocation, via a shell', () => {
    let capturedArgs
    let capturedOptions
    execFileSyncTrigger.impl = (_command, args, options) => {
      capturedArgs = args
      capturedOptions = options
      return JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []})
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
    execFileSyncTrigger.impl = (_command, args) => {
      capturedArgs = args
      return JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []})
    }

    main({GITHUB_OUTPUT: outputFile})

    expect(capturedArgs).toEqual(['--yes', 'unicode-shield@latest', 'scan', '.', '--json'])
  })

  it('does not write outputs when GITHUB_OUTPUT is not set (e.g. running outside Actions)', () => {
    execFileSyncTrigger.impl = () => JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []})

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
    execFileSyncTrigger.impl = () => {
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
    execFileSyncTrigger.impl = () => JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []})

    main({GITHUB_OUTPUT: outputFile, INPUT_VERSION: version})

    expect(process.exitCode).toBeUndefined()
  })

  it.each([
    ['a plain relative path', 'src'],
    ['a nested path', 'src/cli/commands'],
    ['a Windows-style path with a drive letter', 'C:/repo/src'],
    ['the default', '.'],
  ])('accepts %s as a path', (_label, path) => {
    execFileSyncTrigger.impl = () => JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []})

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: path})

    expect(process.exitCode).toBeUndefined()
  })

  it('rejects a path starting with a dash instead of letting it be parsed as a CLI flag', () => {
    execFileSyncTrigger.impl = () => {
      throw new Error('should not have been called')
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: '--json'})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("path must not start with '-'"))
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
    execFileSyncTrigger.impl = () => {
      throw new Error('should not have been called')
    }

    main({GITHUB_OUTPUT: outputFile, INPUT_VERSION: version})

    expect(process.exitCode).toBe(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('version must be a plain version'),
    )
  })
})
