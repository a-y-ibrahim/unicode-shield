import {areConfusable, getSkeleton} from '../../confusables'
import {flagAsBoolean, type ParsedArgs} from '../args'
import type {CommandResult} from '../types'

const USAGE = 'Usage: unicode-shield compare <a> <b> [--json]'

export function runCompare(args: ParsedArgs): CommandResult {
  const [a, b] = args.positionals
  if (a === undefined || b === undefined) {
    return {exitCode: 2, output: USAGE}
  }

  const confusable = areConfusable(a, b)
  const exitCode = confusable ? 1 : 0

  if (flagAsBoolean(args.flags, 'json')) {
    return {
      exitCode,
      output: JSON.stringify({a, b, confusable, skeletonA: getSkeleton(a), skeletonB: getSkeleton(b)}, null, 2),
    }
  }

  return {
    exitCode,
    output: confusable ? `"${a}" and "${b}" are visually confusable.` : `"${a}" and "${b}" are not visually confusable.`,
  }
}
