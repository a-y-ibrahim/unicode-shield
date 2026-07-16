import {readFileSync} from 'node:fs'

/** The special path argument that means "read from stdin" instead of a
 *  real file or directory, the `-` convention `grep`/`jq`/most Unix
 *  tools share. */
export const STDIN_ARG = '-'

/**
 * Reads all of stdin synchronously. File descriptor 0 is stdin on every
 * platform Node supports, unlike the Unix-only `/dev/stdin` path some
 * tools use, so this works the same on Windows and Linux CI alike. Blocks
 * until EOF, exactly like `cat`/`grep` reading a pipe; if stdin is an
 * interactive terminal with nothing piped in, this waits for the user to
 * signal EOF themselves (Ctrl+D on Unix, Ctrl+Z then Enter on Windows),
 * the same as any other Unix-style tool.
 */
export function readStdin(): string {
  return readFileSync(0, 'utf8')
}
