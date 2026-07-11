# unicode-shield

[![CI](https://github.com/a-y-ibrahim/unicode-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/a-y-ibrahim/unicode-shield/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[اقرأ هذا بالعربي](README.ar.md)

Detect and sanitize dangerous Unicode in user-supplied text, without breaking
real RTL text or emoji.

```bash
npm install unicode-shield
```

## Why

Some Unicode characters render as nothing, or make text display as something
other than what it actually is. A malicious username, chat message, or file
name can hide characters that:

- **Reorder how text displays** using bidi embedding/override characters, the
  exact mechanism behind the 2021 "Trojan Source" disclosure
  ([CVE-2021-42574](https://nvd.nist.gov/vuln/detail/CVE-2021-42574)). This is
  the class of bug fixed in
  [`bluesky-social/social-app#11066`](https://github.com/bluesky-social/social-app/pull/11066):
  a handle like `admin` could have invisible characters appended that make it
  copy and paste as something else entirely.
- **Pad or duplicate identity strings** using zero-width characters, so two
  visually identical usernames compare as different, or a blocked word slips
  past a filter.
- **Smuggle invisible instructions** using the deprecated Unicode Tags block
  (U+E0000-U+E007F) or the Variation Selectors Supplement (U+E0100-U+E01EF),
  both repurposed since 2024 as prompt-injection vectors: text encoded in
  these code points renders as nothing in every mainstream font, yet some
  LLMs still read and act on it.

## Why not an existing tool?

Source-code scanners for this character class already exist and are well
built, [`anti-trojan-source`](https://github.com/lirantal/anti-trojan-source)
in particular. They solve a different problem: catching these characters
*in your codebase*. `unicode-shield` is for the other side: catching them
*in data your users type*, at the moment you're about to store or render it.

Before building this, I looked for a runtime library that does that, across
npm, PyPI, crates.io, and pkg.go.dev, plus the open-source security tooling
major AI vendors ship. What turned up was either narrow (zero-width
stripping only, or confusables only), a source/CI scanner applied to the
wrong layer, or a handful of very recent projects that detect the right
characters but strip the legitimate ones too, breaking the exact RTL text
and emoji this library is careful not to touch. I didn't find one that
combines bidi-control detection, Unicode Tags-block detection, and
deliberate preservation of legitimate direction marks and script joiners.
That combination, correctness on the safe side included, is what this is
for.

## The other half of the problem

A tool like this is easy to get wrong in the opposite direction: stripping
*everything* unusual and quietly corrupting real text. Several of the
characters above have completely legitimate uses:

- `‎` (U+200E, LEFT-TO-RIGHT MARK) and `‏` (U+200F, RIGHT-TO-LEFT MARK) are
  single-character direction hints that correct Arabic, Hebrew, and other
  RTL text legitimately relies on.
- `‍` (U+200D, ZERO WIDTH JOINER) is how compound emoji like 👨‍👩‍👧‍👦 are
  built, and is required for correct text shaping in several scripts.
- `‌` (U+200C, ZERO WIDTH NON-JOINER) is required for correct word formation
  in Persian and several Indic scripts.

`unicode-shield` reports these too, because full visibility into what a
string contains is useful, but it never strips them by default. `sanitize()`
only removes the categories that have no legitimate use in a short piece of
user-supplied text.

## Usage

```ts
import {scan, sanitize, isSafe} from 'unicode-shield'

isSafe('admin')                    // true
isSafe('admin\u{202E}nimda')       // false, contains a bidi override

sanitize('admin\u{202E}nimda')     // 'adminnimda'

scan('price: 100\u{200E}\u{200F} ريال\u{061C}')
// {
//   safe: true,   // only informational bidi marks, nothing dangerous
//   threats: [
//     { category: 'bidi-mark', severity: 'informational', codePoint: 0x200e, ... },
//     { category: 'bidi-mark', severity: 'informational', codePoint: 0x200f, ... },
//     { category: 'bidi-mark', severity: 'informational', codePoint: 0x61c, ... },
//   ]
// }
```

### `scan(input: string): ScanResult`

Returns every threat found in `input`, dangerous and informational alike.
`safe` is `true` only when there are zero dangerous threats.

### `sanitize(input: string, options?: SanitizeOptions): string`

Returns `input` with dangerous characters removed. By default this strips
`bidi-embedding`, `bidi-isolate`, `invisible`, `tag`, and `variation-selector`
categories. Informational categories (`bidi-mark`, `joiner`) are never touched
unless you explicitly opt in:

```ts
sanitize(input, {categories: ['bidi-mark']})   // also strips LRM/RLM/ALM
sanitize(input, {replacement: '�'})       // substitute instead of delete
```

### `isSafe(input: string): boolean`

Shorthand for `scan(input).safe`.

## Threat categories

| Category         | Severity        | Examples                              | Stripped by default |
| ----------------- | --------------- | -------------------------------------- | -------------------- |
| `bidi-embedding`  | dangerous       | LRE, RLE, LRO, RLO, PDF                | yes |
| `bidi-isolate`    | dangerous       | LRI, RLI, FSI, PDI                     | yes |
| `invisible`       | dangerous       | zero-width space, word joiner, stray BOM | yes |
| `tag`             | dangerous       | U+E0000-U+E007F (deprecated Tags block) | yes |
| `variation-selector` | dangerous    | U+E0100-U+E01EF (Variation Selectors Supplement) | yes |
| `bidi-mark`       | informational   | LRM, RLM, ALM                          | no |
| `joiner`          | informational   | ZWJ, ZWNJ                              | no |

Note on `variation-selector`: only the Supplement block is covered. The base
Variation Selectors block (U+FE00-U+FE0F, VS15/VS16) is never flagged, since
that's how ordinary text picks text-style vs emoji-style presentation for
thousands of common characters and emoji, and is extremely common in real
user text.

## ESLint plugin

`scan`/`sanitize` only help if something actually calls them. The other way
this class of bug ships is a data path that never runs through either one:
`unicode-shield/eslint-plugin` catches that at review time instead of in
production, by checking whether identity-like text (a username, a handle, a
display name, a bio) reaches JSX unsanitized. This is a code-structure check
of the kind described in "Why not an existing tool?" above as source/CI
scanning, not the runtime text scanning `scan()` does, and unlike a general
source scanner it's specifically about whether *this library's* `sanitize()`
sits in the path before a risky-looking value renders.

```js
// eslint.config.js
import unicodeShield from 'unicode-shield/eslint-plugin'

export default [
  {
    plugins: {'unicode-shield': unicodeShield},
    rules: {'unicode-shield/require-sanitized-text': 'warn'},
  },
]
```

```jsx
<Text>{user.displayName}</Text>            // flagged

<Text>{sanitize(user.displayName)}</Text>  // fine

const safeName = sanitize(user.displayName)
<Text>{safeName}</Text>                    // fine, traced back to the sanitize() call
```

### `require-sanitized-text`

Flags a JSX child expression when it's a bare identifier or a property access
with a statically known name, dot or bracket notation alike (`{username}`,
`{user.bio}`, `{user["bio"]}`), whose name matches a configured list of
identity-like names, unless it's wrapped in `sanitize(...)` right there, or
traced back exactly one declaration to a local variable assigned from a
`sanitize(...)` call.

| Option | Default | |
| --- | --- | --- |
| `riskyNames` | `['username', 'handle', 'displayname', 'nickname', 'bio']` | Case-insensitive substring match against the identifier or property name. Replaces the default list rather than extending it. |
| `sanitizerNames` | `['sanitize']` | Function names, bare or as a property (e.g. `unicodeShield.sanitize`), recognized as sanitizing their argument. |

**What this rule deliberately doesn't do**, v1 scope rather than an
oversight:

- Checks only JSX *children* (`<Text>{x}</Text>`), not attributes
  (`alt={x}`, `title={x}`). Attribute sinks are a known gap.
- Understands only a bare identifier or one property access (a computed key
  like `user[someVariable]` can't be resolved statically and is skipped),
  and traces a variable back exactly one declaration. It's a naming
  heuristic, not real data-flow analysis: `{formatHandle(handle)}` isn't
  inspected, and reassignment (`let x = a; x = b`) isn't followed.
- Matches names by case-insensitive substring, so a name like
  `usernamePattern` can false-positive. Rename the variable, adjust
  `riskyNames`, or disable the line.
- Only recognizes a `sanitize()` call (or a name added to `sanitizerNames`)
  as proof of safety, not an `isSafe()` guard.

Requires `eslint >= 9`, declared as an optional peer dependency: the core
`scan`/`sanitize`/`isSafe` API has no dependency on ESLint at all, only this
subpath does.

## What this is not

This is not a source-code scanner, a profanity filter, or a homoglyph
(lookalike-character) detector. It is scoped to the bidi and invisible
character classes above. Confusable/homoglyph detection is real, valuable,
and a large enough problem (thousands of Unicode-defined mappings) that it
belongs in its own release rather than a half-implemented add-on here.

## License

MIT
