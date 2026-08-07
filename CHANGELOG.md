# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `unicode-shield scan --format sarif`, a [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
  report alongside the existing human-readable and `--json` output, one
  rule per threat category (plus two coverage-gap rules for a file or
  directory that couldn't be read) with GitHub Code Scanning's own
  `security-severity` scoring convention. `--json` stays a shorthand for
  `--format json`; the two only conflict, and error, if given together
  with different values.
- The GitHub Action's new `sarif` input (default `false`): set to `true`
  to also upload results to the repository's Security > Code scanning tab
  via `github/codeql-action/upload-sarif`, a persistent, dismissible alert
  instead of a PR annotation that disappears once the PR closes. Needs
  `permissions: security-events: write` on the calling job (and
  `actions: read` too on a private repository); a SARIF generation
  failure only warns rather than failing the step, since the existing
  annotations/outputs already succeeded independently of it, and the
  upload step itself is skipped rather than run against an empty file
  when that happens. Exposes a new `sarif-path` output with the generated
  file's path, and a new `category` input passed straight through to
  upload-sarif's own `category`, for a workflow that calls this action
  more than once against the same commit (a build matrix, or scanning
  more than one path), where uploads with no category would otherwise
  silently replace each other in the Security tab instead of being
  tracked separately.

### Fixed

- The GitHub Action's own `::error`/`::warning` annotation message read
  "a invisible character character" and "a Unicode tag character
  character" (the category's own label already ended in "character",
  and the message template appended another one unconditionally), and
  "a stacked combining marks character" for `combining-marks` (singular
  "a" against a plural noun). All three now read as a single,
  grammatically correct phrase. Found while writing the SARIF formatter
  above and noticing its equivalent message needed the same fix; present
  since the Action's first release, never covered by a test that checked
  either category's exact message text.
- A `path` resolving to a Windows drive-letter absolute path (`C:/repo/src`,
  already accepted and tested for the Action's `path` input) produced an
  invalid SARIF `artifactLocation.uri`: `C:/repo/src/app.ts` parses with
  `c:` read as the URI's own scheme, silently discarding the drive letter,
  confirmed directly against Node's URL parser. Now correctly emitted as
  `/C:/repo/src/app.ts`, the same convention `file:` URLs use for Windows
  paths.

## [0.8.1] - 2026-08-07

### Added

- A GitHub Action (`uses: a-y-ibrahim/unicode-shield@v0.8.1`), wrapping the
  CLI's `scan` command for CI: findings show up as inline `::error`/
  `::warning` annotations on the commit or pull request instead of being
  buried in a log. Takes `path`, `version`, and `fail-on-threat` inputs,
  and exposes `safe`/`threat-count` outputs. `path` and `version` are both
  validated against a narrow, allowlisted character set before running
  anything, deliberately narrower than either could technically support
  (no spaces in `path`, no leading `-` or `..` segment in `path`, no
  `^`/boolean/comparison version ranges, no leading `.` in `version`),
  since both get passed through a shell to work around a Windows-specific
  quirk in how `npx` itself has to be invoked there, and that's what keeps
  it safe. `^` is excluded because cmd.exe silently consumes it as its own
  escape character before `npx` ever sees it, confirmed directly. A
  leading `.` in `version` is excluded because npm resolves that as a
  local directory instead of a registry lookup, independent of the package
  name before the `@`, which was confirmed exploitable end to end (an
  attacker-controlled local package ran in place of the real one) before
  being fixed. See the README's GitHub Action section for full usage.

## [0.7.0] - 2026-07-19

### Added

- `unicode-shield/eslint-plugin`'s `require-sanitized-text` rule now supports
  `--fix`: it wraps the flagged value in a call (`user.bio` becomes
  `sanitize(user.bio)`) and adds or reuses the import needed to make that
  call valid, merging into an existing `unicode-shield` import if one is
  already present. A new `autoImport` option controls what's wrapped/imported
  (or disables the fix entirely with `autoImport: false`), for projects that
  sanitize through their own wrapper instead of calling this package's
  `sanitize()` directly. Correctly treats a TypeScript `import type` (or a
  per-specifier `import {type x}`) as binding no runtime value, so it's
  never mistaken for an existing sanitize import. Withholds the fix,
  rather than risking broken output or silently sanitizing nothing, if
  `autoImport.name` isn't a valid, non-reserved identifier; if it's
  already bound to something unrelated in the file, including an aliased
  import of a *different* export renamed to that local name, or the same
  name declared inside the very function the flagged value is in (which
  would shadow a module-level import for that reference specifically); or
  if the file itself isn't a module (`import` doesn't work there at all).
- `require-sanitized-text` now sees through optional chaining: `{user?.bio}`
  and `alt={user?.bio}` are flagged and fixed the same as `{user.bio}`, and
  an optionally-called sanitizer (`sanitize?.(bio)`) is recognized as
  already-safe the same as a plain call. Previously the whole expression
  went unanalyzed, exactly for fields that are optional-chained precisely
  because they're optional.

### Changed

- Existing `require-sanitized-text` users may see new warnings on
  optionally-chained access to a risky name (`{user?.bio}`) that previously
  passed silently, the same kind of previously-undetected gap closed for
  JSX attributes in 0.4.0.

## [0.6.0] - 2026-07-18

### Added

- `unicode-shield scan` and `unicode-shield sanitize` now accept `-` as
  the path, meaning stdin, the standard `grep`/`jq` convention. Enables
  real Unix pipelines: `cat file.txt | unicode-shield scan -`, or
  `some-tool | unicode-shield sanitize - | another-tool`. `--write` is
  rejected with stdin input, since there's no file to write back to.

## [0.5.0] - 2026-07-16

### Added

- A command line tool, installed alongside the library: `unicode-shield
  scan <path>`, `unicode-shield sanitize <path>`, and `unicode-shield
  compare <a> <b>`, covering `scan()`, `sanitize()`, and `areConfusable()`
  respectively for files and directories, no code required. Supports
  `--json` output, recursive directory scanning (skipping `node_modules`,
  `.git`, and binary files), and standard exit codes (`0` clean, `1`
  threat or confusable pair found, `2` usage or runtime error) for CI use.
  See the README's CLI section for full usage.

## [0.4.0] - 2026-07-14

### Added

- `unicode-shield/eslint-plugin`'s `require-sanitized-text` rule now also
  checks text-rendering JSX attributes (`alt`, `title`, `placeholder`,
  `aria-label`, `value`), not just rendered children. A new
  `riskyAttributes` option controls the checked attribute list, following
  the same replace-the-default pattern as `riskyNames`. Previously
  documented as an out-of-scope gap; closed.

### Changed

- Existing `require-sanitized-text` users may see new warnings on code that
  previously passed, for example `<img alt={user.bio} />`, if attribute
  values match a `riskyNames` entry. This is the intended effect of closing
  the gap above, not a bug; adjust `riskyAttributes` to opt out of specific
  attributes if needed.

## [0.3.0] - 2026-07-13

### Added

- Combining-mark stacking ("Zalgo text") detection: `scan()`/`sanitize()`
  gain a new `combining-marks` category that flags more than 6 Unicode
  Nonspacing_Mark (Mn) characters stacked on a single base character, the
  technique behind visual harassment and chat/username corruption.
  `sanitize()` caps a run at 6 marks instead of stripping all of them.
  Verified against dense real-world diacritic use (fully-voweled Arabic,
  Hebrew niqqud and cantillation, Vietnamese) to stay well clear of the
  threshold.

## [0.2.1] - 2026-07-13

### Fixed

- This file (`CHANGELOG.md`) is now actually included in the published
  package. It was added to the repository right after 0.2.0 shipped, so
  that tarball didn't contain it yet.

## [0.2.0] - 2026-07-13

### Added

- ESLint plugin (`unicode-shield/eslint-plugin`) with a `require-sanitized-text`
  rule that flags identity-like text (username, handle, display name, bio)
  reaching JSX unsanitized.
- Confusables and mixed-script detection (`unicode-shield/confusables`):
  `getSkeleton`, `areConfusable`, `detectMixedScript`, built on Unicode's own
  UTS #39 security data. Ships as a separate subpath so the core `scan`/
  `sanitize`/`isSafe` bundle size is unaffected.

### Fixed

- `sanitize()`'s `invisible` category now also catches U+2061-U+2064,
  zero-width math-operator characters in the same Unicode block as the
  already-covered WORD JOINER.

### Notes

- The generated Unicode data behind the confusables subpath ships under its
  own license, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## [0.1.0] - 2026-07-10

### Added

- Initial release: `scan()`, `sanitize()`, `isSafe()`.
- Detection for bidi embedding/override characters (the Trojan Source class,
  [CVE-2021-42574](https://nvd.nist.gov/vuln/detail/CVE-2021-42574)), bidi
  isolates, bidi marks, zero-width/invisible characters, the deprecated
  Unicode Tags block (U+E0000-U+E007F), and the Variation Selectors
  Supplement (U+E0100-U+E01EF).

[0.8.1]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.8.1
[0.7.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.7.0
[0.6.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.6.0
[0.5.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.5.0
[0.4.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.4.0
[0.3.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.3.0
[0.2.1]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.2.1
[0.2.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.2.0
