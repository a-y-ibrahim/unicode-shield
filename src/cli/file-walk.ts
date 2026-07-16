import {readFileSync, readdirSync, statSync} from 'node:fs'
import {extname, join} from 'node:path'

/**
 * Directories skipped when recursing, dependency trees and build output
 * this tool has no business scanning.
 */
const SKIPPED_DIRECTORY_NAMES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage'])

/**
 * File extensions skipped during a directory walk. A denylist rather than
 * an allowlist on purpose: this tool's whole point is catching dangerous
 * text in arbitrary user content, an unfamiliar text extension should
 * still be scanned by default rather than silently skipped.
 */
const SKIPPED_EXTENSIONS = new Set([
  // images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif', '.tiff',
  // audio/video
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi', '.flac',
  // archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  // fonts
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // compiled or otherwise non-text
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.pdf', '.class', '.pyc', '.db', '.sqlite', '.node',
])

/**
 * Resolves a CLI path argument to the list of file paths it covers: itself,
 * if it's a file, or every non-skipped file inside it recursively, if it's
 * a directory.
 */
export function resolveFiles(inputPath: string): string[] {
  const stat = statSync(inputPath)
  if (stat.isFile()) return [inputPath]
  if (!stat.isDirectory()) return []

  const results: string[] = []
  const stack = [inputPath]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          stack.push(join(dir, entry.name))
        }
        continue
      }
      if (entry.isFile() && !SKIPPED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push(join(dir, entry.name))
      }
    }
  }
  return results
}

export function isDirectory(inputPath: string): boolean {
  return statSync(inputPath).isDirectory()
}

export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8')
}
