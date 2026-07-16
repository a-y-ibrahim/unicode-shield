import {afterEach, describe, expect, it, vi} from 'vitest'

// vi.mock factories are hoisted above imports, so state they close over
// can't be a plain outer-scope variable; vi.hoisted() is vitest's
// documented way to share it. null means "don't intercept, behave
// normally".
const stdinContentTrigger = vi.hoisted(() => ({content: null as string | null}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: (path: Parameters<typeof actual.readFileSync>[0], options: Parameters<typeof actual.readFileSync>[1]) => {
      if (path === 0 && stdinContentTrigger.content !== null) {
        return stdinContentTrigger.content
      }
      return actual.readFileSync(path, options)
    },
  }
})

const {readStdin, STDIN_ARG} = await import('../../cli/stdin')

describe('readStdin', () => {
  afterEach(() => {
    stdinContentTrigger.content = null
  })

  it('returns the content read from file descriptor 0', () => {
    stdinContentTrigger.content = 'hello from stdin'
    expect(readStdin()).toBe('hello from stdin')
  })

  it('returns real Unicode content unmangled', () => {
    stdinContentTrigger.content = 'مرحبا'
    expect(readStdin()).toBe('مرحبا')
  })
})

describe('STDIN_ARG', () => {
  it('is the standard single-dash convention', () => {
    expect(STDIN_ARG).toBe('-')
  })
})
