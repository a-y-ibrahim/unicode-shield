export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | boolean>
}

/**
 * Flag names that never take a value, `--json` in particular. Without this,
 * a boolean flag followed by an unrelated positional (`scan-target --json
 * other-positional`) is genuinely ambiguous: nothing about "other-positional"
 * marks it as not being --json's value. Listing the known booleans up front
 * resolves that ambiguity instead of guessing.
 */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['json', 'write'])

/**
 * Minimal, dependency-free flag parser for this CLI's small, fixed option
 * set. Supports `--flag`, `--flag value`, `--flag=value`, bare positional
 * arguments, and a literal `--` that forces everything after it to be
 * treated as positional (so a value that itself starts with `--`, an
 * unusual but legal string to compare, is never misread as a flag).
 * Doesn't support short flags (`-f`) or flag stacking, this CLI's option
 * set doesn't need them.
 */
export function parseArgs(argv: string[], booleanFlags: ReadonlySet<string> = BOOLEAN_FLAGS): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  let onlyPositionals = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!

    if (onlyPositionals) {
      positionals.push(arg)
      continue
    }
    if (arg === '--') {
      onlyPositionals = true
      continue
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const equalsIndex = arg.indexOf('=')
    if (equalsIndex !== -1) {
      flags[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1)
      continue
    }

    const name = arg.slice(2)
    if (booleanFlags.has(name)) {
      flags[name] = true
      continue
    }

    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next
      i++
    } else {
      flags[name] = true
    }
  }

  return {positionals, flags}
}

export function flagAsString(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

export function flagAsBoolean(flags: ParsedArgs['flags'], name: string): boolean {
  return flags[name] === true
}
