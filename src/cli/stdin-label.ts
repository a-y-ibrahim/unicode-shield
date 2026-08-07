/**
 * The path label used for a stdin-sourced scan result, in place of a real
 * file path. Shared rather than redefined per module: sarif.ts needs the
 * exact same value scan.ts uses to recognize a result that has no real
 * file for a SARIF location to point at.
 */
export const STDIN_PATH_LABEL = '(stdin)'
