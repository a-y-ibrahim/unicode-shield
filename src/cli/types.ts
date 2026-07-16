/**
 * What every command runner returns: the process exit code (0 = clean,
 * 1 = a threat/confusable pair was found, 2 = usage or runtime error, the
 * same convention `grep`/`eslint` use) and the text to print.
 */
export interface CommandResult {
  exitCode: number
  output: string
}
