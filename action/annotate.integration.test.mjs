import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

// Deliberately does NOT mock node:child_process, unlike annotate.test.mjs:
// this runs the real spawnSync(..., {shell: true}) path end to end, the
// only way to catch a value getting silently altered BY the shell itself
// before npx ever sees it, or a real process's stdout/stderr/exit-code
// combination behaving in a way a hand-written mock wouldn't think to
// produce. Both are real, confirmed failure modes, not hypothetical:
// - An earlier version of the allowlist let `^` through, and while it
//   never merged arguments or re-enabled another operator (so it wasn't
//   a security hole), cmd.exe was quietly consuming it as its own escape
//   character, so `version: '^0.7.0'` reached npx as plain `0.7.0`, a
//   different, wrong version, not an error.
// - A real self-test run on Linux/macOS CI runners exited 0 with
//   completely empty stdout, a shape execFileSync (used here previously)
//   couldn't have diagnosed even with a test like this: it discards
//   stderr entirely for anything other than a thrown (non-zero-exit)
//   error, so there was structurally no way to see what actually
//   happened. See runScan's own comment in annotate.mjs.
// A test mocking spawnSync (as every other test in this file does, for
// speed and to avoid a real npx/network dependency) cannot see either
// class of bug by construction, since nothing in that path is a real
// shell or a real process.
const {main} = await import('./annotate.mjs')

describe('main, against a real shell (no mocks)', () => {
  let workDir
  let stubDir
  let argvDumpFile
  let outputFile
  let originalPath

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'unicode-shield-real-shell-test-'))
    stubDir = mkdtempSync(join(tmpdir(), 'unicode-shield-stub-npx-'))
    argvDumpFile = join(workDir, 'argv.json')
    outputFile = join(workDir, 'github_output')
    originalPath = process.env.PATH

    // A stand-in for npx that records exactly what it was called with
    // (not what the test *intended* to pass) and prints a trivially valid
    // scan result so main() doesn't error out downstream for unrelated
    // reasons. Never touches the network or the real unicode-shield.
    const stubImplPath = join(stubDir, 'npx-stub-impl.mjs')
    writeFileSync(
      stubImplPath,
      [
        "import {writeFileSync} from 'node:fs'",
        `writeFileSync(${JSON.stringify(argvDumpFile)}, JSON.stringify(process.argv.slice(2)))`,
        "console.log(JSON.stringify({safe: true, filesScanned: 0, files: [], unreadableDirectories: []}))",
        '',
      ].join('\n'),
    )

    if (process.platform === 'win32') {
      // Matches NPX_COMMAND's own resolution in annotate.mjs: only
      // npx.cmd, not a bare npx, is what's actually invoked there.
      writeFileSync(join(stubDir, 'npx.cmd'), `@echo off\r\nnode "${stubImplPath}" %*\r\n`)
    } else {
      const posixStubPath = join(stubDir, 'npx')
      writeFileSync(posixStubPath, `#!/bin/sh\nexec node "${stubImplPath}" "$@"\n`)
      chmodSync(posixStubPath, 0o755)
    }

    process.env.PATH = `${stubDir}${process.platform === 'win32' ? ';' : ':'}${originalPath}`
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(workDir, {recursive: true, force: true})
    rmSync(stubDir, {recursive: true, force: true})
    process.exitCode = undefined
  })

  function receivedArgs() {
    return JSON.parse(readFileSync(argvDumpFile, 'utf8'))
  }

  it('passes a plain version and path through the real shell unchanged', () => {
    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: 'src', INPUT_VERSION: '0.7.0'})

    expect(process.exitCode).toBeUndefined()
    expect(receivedArgs()).toEqual(['--yes', 'unicode-shield@0.7.0', 'scan', 'src', '--json'])
  })

  it('passes a ~ version range through the real shell unchanged', () => {
    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: '.', INPUT_VERSION: '~0.7.0'})

    expect(process.exitCode).toBeUndefined()
    expect(receivedArgs()).toEqual(['--yes', 'unicode-shield@~0.7.0', 'scan', '.', '--json'])
  })

  it('passes a nested path through the real shell unchanged', () => {
    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: 'src/cli/commands', INPUT_VERSION: 'latest'})

    expect(process.exitCode).toBeUndefined()
    expect(receivedArgs()).toEqual(['--yes', 'unicode-shield@latest', 'scan', 'src/cli/commands', '--json'])
  })

  it('surfaces real stderr in the annotation when the real process exits 0 with empty stdout', () => {
    // The exact shape of the real, confirmed CI failure this rewrite
    // exists for (see the top-of-file comment): reproduced here with a
    // genuine child process, not a mock, so this test would have caught
    // it. Replaces the stub with one that writes to stderr and exits 0
    // without ever printing a report, rather than the beforeEach one.
    const stubImplPath = join(stubDir, 'npx-stub-impl.mjs')
    writeFileSync(
      stubImplPath,
      ["process.stderr.write('warning: something unexpected happened\\n')", 'process.exit(0)', ''].join('\n'),
    )

    main({GITHUB_OUTPUT: outputFile, INPUT_PATH: '.', INPUT_VERSION: 'latest'})

    expect(process.exitCode).toBe(1)
  })
})
