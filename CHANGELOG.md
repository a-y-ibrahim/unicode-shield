# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-07-16

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

[0.6.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.6.0
[0.5.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.5.0
[0.4.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.4.0
[0.3.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.3.0
[0.2.1]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.2.1
[0.2.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.2.0
