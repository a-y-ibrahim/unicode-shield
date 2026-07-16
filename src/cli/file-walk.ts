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

export interface ResolvedFiles {
  files: string[]
  /**
   * Subdirectories encountered during the walk that couldn't be listed
   * (permission denied, removed mid-walk, ...). Tracked and reported
   * rather than silently dropped, a scan that quietly skipped part of a
   * directory tree would be worse than one that says so.
   */
  unreadableDirectories: string[]
}

/**
 * Resolves a CLI path argument to the file paths it covers: itself, if it's
 * a file, or every non-skipped file inside it recursively, if it's a
 * directory. A directory the top-level `inputPath` itself points at that
 * can't be listed still throws (there is nothing to resolve); a nested
 * subdirectory hit during the walk that can't be listed is skipped and
 * recorded instead, so one bad subdirectory doesn't abort scanning
 * everything else found before it.
 */
export function resolveFiles(inputPath: string): ResolvedFiles {
  const stat = statSync(inputPath)
  if (stat.isFile()) return {files: [inputPath], unreadableDirectories: []}
  if (!stat.isDirectory()) return {files: [], unreadableDirectories: []}

  const files: string[] = []
  const unreadableDirectories: string[] = []
  const stack = [inputPath]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, {withFileTypes: true})
    } catch {
      unreadableDirectories.push(dir)
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          stack.push(join(dir, entry.name))
        }
        continue
      }
      if (entry.isFile() && !SKIPPED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(join(dir, entry.name))
      }
    }
  }
  return {files, unreadableDirectories}
}

export function isDirectory(inputPath: string): boolean {
  return statSync(inputPath).isDirectory()
}

export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8')
}
