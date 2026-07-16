import {describe, expect, it} from 'vitest'

import {run} from '../../cli/index'

describe('run (command dispatch)', () => {
  it('shows help and exits 0 with no arguments', () => {
    const result = run([])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('unicode-shield <command>')
  })

  it('shows help for --help and -h', () => {
    expect(run(['--help']).output).toContain('Commands:')
    expect(run(['-h']).output).toContain('Commands:')
  })

  it('mentions stdin support in the help text', () => {
    expect(run(['--help']).output).toContain('stdin')
  })

  it('shows a real semver-looking version for --version and -v', () => {
    const versionPattern = /^\d+\.\d+\.\d+$/
    expect(run(['--version']).output).toMatch(versionPattern)
    expect(run(['-v']).output).toMatch(versionPattern)
  })

  it('exits 2 with a helpful message for an unknown command', () => {
    const result = run(['frobnicate'])
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Unknown command: frobnicate')
    expect(result.output).toContain('Commands:')
  })

  it('dispatches "scan" to the scan command (usage error with no path)', () => {
    const result = run(['scan'])
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Usage: unicode-shield scan')
  })

  it('dispatches "sanitize" to the sanitize command (usage error with no path)', () => {
    const result = run(['sanitize'])
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('Usage: unicode-shield sanitize')
  })

  it('dispatches "compare" to the compare command, end to end with real string arguments', () => {
    const result = run(['compare', 'apple', 'orange'])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('not visually confusable')
  })
})
