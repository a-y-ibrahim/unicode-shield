# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

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

[0.2.1]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.2.1
[0.2.0]: https://github.com/a-y-ibrahim/unicode-shield/releases/tag/v0.2.0
