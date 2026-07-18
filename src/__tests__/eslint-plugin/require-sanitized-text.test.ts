import {Linter, RuleTester} from 'eslint'
import tsParser from '@typescript-eslint/parser'
import {describe, expect, it} from 'vitest'

import rule from '../../eslint-plugin/rules/require-sanitized-text'

const typescriptLanguageOptions = {
  ecmaVersion: 2022 as const,
  sourceType: 'module' as const,
  parser: tsParser,
  parserOptions: {ecmaFeatures: {jsx: true}},
}

// eslint's RuleTester defaults to a Mocha-style global describe/it. This is
// the documented way to point it at any other test runner instead.
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: {jsx: true},
    },
  },
})

ruleTester.run('require-sanitized-text', rule, {
  valid: [
    // Not identity-like text at all.
    '<div>{count}</div>',
    '<div>{items.length}</div>',

    // Sanitized inline, right at the point of use.
    '<div>{sanitize(username)}</div>',
    '<div>{sanitize(user.bio)}</div>',

    // Sanitized inside a fragment and inside a list-rendering callback,
    // the two most common real-world JSX shapes beyond a single element.
    '<>{sanitize(username)}</>',
    'users.map(u => <li>{sanitize(u.username)}</li>)',

    // Sanitized one hop back, through a traceable local declaration. The
    // traced variable's own name (sanitizedUsername) must still match a
    // risky pattern, otherwise this would pass for the wrong reason.
    'const sanitizedUsername = sanitize(username); const el = <div>{sanitizedUsername}</div>',
    'function Profile({username}) { const sanitizedUsername = sanitize(username); return <div>{sanitizedUsername}</div> }',

    // Only text-rendering attributes are checked. onChange is a handler,
    // not a text sink, so it's never analyzed regardless of the value's
    // name (handleChange still matches the "handle" risky-name substring).
    '<input onChange={handleChange} />',

    // A risky attribute with a value whose name isn't risky.
    '<img alt={description} />',

    // A risky-named value on an attribute that isn't a text sink.
    '<div className={username} />',

    // Sanitized inline in an attribute position, same as a child position.
    '<img alt={sanitize(user.bio)} />',
    'const safeBio = sanitize(user.bio); const el = <img alt={safeBio} />',

    // Calls other than the outer expression aren't analyzed (one-hop heuristic).
    '<div>{formatHandle(handle)}</div>',

    // A custom sanitizer name is honored the same way as the default.
    {
      code: 'const sanitizedUsername = clean(username); const el = <div>{sanitizedUsername}</div>',
      options: [{sanitizerNames: ['clean']}],
    },

    // A custom riskyNames list replaces the default, not merges with it.
    {
      code: '<div>{username}</div>',
      options: [{riskyNames: ['secret']}],
    },

    // Computed access with a non-literal key can't be resolved statically,
    // so it's left alone rather than guessed at.
    '<div>{user[key]}</div>',

    // Sanitized inline through computed member access, both as the value
    // and as the sanitizer call itself.
    '<div>{sanitize(user["bio"])}</div>',
    'const sanitizedBio = obj["sanitize"](user.bio); const el = <div>{sanitizedBio}</div>',
  ],
  invalid: [
    {
      code: '<div>{username}</div>',
      output: "import {sanitize} from 'unicode-shield';\n\n<div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      code: '<div>{user.username}</div>',
      output: "import {sanitize} from 'unicode-shield';\n\n<div>{sanitize(user.username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      code: '<div>{profile.displayName}</div>',
      output: "import {sanitize} from 'unicode-shield';\n\n<div>{sanitize(profile.displayName)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'displayName'}}],
    },
    {
      // A destructured prop has no traceable sanitize() initializer, so it's
      // flagged exactly like any other unsanitized identifier.
      code: 'function Profile({username}) { return <div>{username}</div> }',
      output:
        "import {sanitize} from 'unicode-shield';\n\nfunction Profile({username}) { return <div>{sanitize(username)}</div> }",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // Traced back to its declaration, but that declaration never sanitizes.
      code: 'const bio = user.bio; const el = <div>{bio}</div>',
      output: "import {sanitize} from 'unicode-shield';\n\nconst bio = user.bio; const el = <div>{sanitize(bio)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'bio'}}],
    },
    {
      code: '<div>{secret}</div>',
      options: [{riskyNames: ['secret']}],
      output: "import {sanitize} from 'unicode-shield';\n\n<div>{sanitize(secret)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'secret'}}],
    },
    {
      // Fragments are a distinct AST node from a plain element; must be
      // recognized as a children position too, not just JSXElement.
      code: '<>{username}</>',
      output: "import {sanitize} from 'unicode-shield';\n\n<>{sanitize(username)}</>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // The single most common real-world shape this rule needs to catch:
      // an unsanitized field rendered inside a .map() list callback.
      code: 'users.map(u => <li>{u.username}</li>)',
      output: "import {sanitize} from 'unicode-shield';\n\nusers.map(u => <li>{sanitize(u.username)}</li>)",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // sanitize() is called, but on a different variable: safeBio's own
      // declaration is untraced, so it's still flagged.
      code: 'const other = sanitize(x); const safeBio = user.bio; const el = <div>{safeBio}</div>',
      output:
        "import {sanitize} from 'unicode-shield';\n\nconst other = sanitize(x); const safeBio = user.bio; const el = <div>{sanitize(safeBio)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'safeBio'}}],
    },
    {
      // A statically known computed key (bracket notation) is just as
      // risky as dot notation and must not be a way to slip past the rule.
      code: '<div>{user["username"]}</div>',
      output: "import {sanitize} from 'unicode-shield';\n\n<div>{sanitize(user[\"username\"])}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      code: '<img alt={user.bio} />',
      output: "import {sanitize} from 'unicode-shield';\n\n<img alt={sanitize(user.bio)} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'alt'}}],
    },
    {
      code: '<div title={handle}>{count}</div>',
      output: "import {sanitize} from 'unicode-shield';\n\n<div title={sanitize(handle)}>{count}</div>",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'handle', attribute: 'title'}}],
    },
    {
      code: '<input placeholder={handle} />',
      output: "import {sanitize} from 'unicode-shield';\n\n<input placeholder={sanitize(handle)} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'handle', attribute: 'placeholder'}}],
    },
    {
      // Hyphenated attribute names (JSX allows these as a special case)
      // must resolve the same way plain identifiers do.
      code: '<div aria-label={user.username} />',
      output: "import {sanitize} from 'unicode-shield';\n\n<div aria-label={sanitize(user.username)} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'username', attribute: 'aria-label'}}],
    },
    {
      code: '<input value={user.nickname} />',
      output: "import {sanitize} from 'unicode-shield';\n\n<input value={sanitize(user.nickname)} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'nickname', attribute: 'value'}}],
    },
    {
      // Computed member access works the same in an attribute position as
      // it does in a child position.
      code: '<img alt={user["bio"]} />',
      output: "import {sanitize} from 'unicode-shield';\n\n<img alt={sanitize(user[\"bio\"])} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'alt'}}],
    },
    {
      // Attribute checking looks at the attribute name only, not the tag,
      // so a custom or third-party component (Avatar, Tooltip, ...) that
      // happens to accept a same-named prop is covered exactly like a
      // native HTML element.
      code: '<Avatar alt={user.bio} />',
      output: "import {sanitize} from 'unicode-shield';\n\n<Avatar alt={sanitize(user.bio)} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'alt'}}],
    },
    {
      // riskyAttributes matching is case-insensitive, same as riskyNames.
      code: '<img ALT={user.bio} />',
      output: "import {sanitize} from 'unicode-shield';\n\n<img ALT={sanitize(user.bio)} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'ALT'}}],
    },
    {
      // Both a risky child and a risky attribute on the same element are
      // reported independently. Only the first (alt) fixes in this single
      // pass: both violations need the same new import inserted at the same
      // point, so their combined fix ranges overlap and ESLint applies just
      // one per pass, exactly as it would for any two conflicting fixes.
      // The multi-pass convergence (title getting fixed too, on a second
      // pass) is covered separately below with the real Linter, since
      // RuleTester's `output` only ever reflects a single pass.
      code: '<img alt={user.bio} title={user.displayName} />',
      output:
        "import {sanitize} from 'unicode-shield';\n\n<img alt={sanitize(user.bio)} title={user.displayName} />",
      errors: [
        {messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'alt'}},
        {messageId: 'requireSanitizeAttribute', data: {name: 'displayName', attribute: 'title'}},
      ],
    },
    {
      // A custom riskyAttributes list replaces the default, not merges with
      // it, mirroring how riskyNames already behaves.
      code: '<img data-testid={username} />',
      options: [{riskyAttributes: ['data-testid']}],
      output: "import {sanitize} from 'unicode-shield';\n\n<img data-testid={sanitize(username)} />",
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'username', attribute: 'data-testid'}}],
    },

    // --fix's import handling, one scenario per case.
    {
      // No import from unicode-shield at all yet: insert a fresh one before
      // the file's first statement.
      code: 'const el = <div>{username}</div>',
      output: "import {sanitize} from 'unicode-shield';\n\nconst el = <div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // An import from unicode-shield already exists, but not `sanitize`:
      // merge into its existing named-specifier list instead of adding a
      // second import statement from the same source.
      code: "import {scan} from 'unicode-shield'\nconst el = <div>{username}</div>",
      output:
        "import {scan, sanitize} from 'unicode-shield'\nconst el = <div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // sanitize is already imported under that exact name: no import edit
      // at all, just the wrap.
      code: "import {sanitize} from 'unicode-shield'\nconst el = <div>{username}</div>",
      output: "import {sanitize} from 'unicode-shield'\nconst el = <div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // Existing imports are from other sources entirely: the new import is
      // inserted after the last of them, not before the file's first line.
      code: "import React from 'react'\nimport {useState} from 'react'\nconst el = <div>{username}</div>",
      output:
        "import React from 'react'\nimport {useState} from 'react'\nimport {sanitize} from 'unicode-shield';\nconst el = <div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // autoImport: false reports without offering any fix at all, for
      // setups where wrapping in a bare sanitize(...) call and importing it
      // from unicode-shield wouldn't be safe to assume automatically.
      code: 'const el = <div>{username}</div>',
      options: [{autoImport: false}],
      output: null,
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // A custom autoImport target is honored: the fix wraps with the
      // configured name and imports it from the configured source, not the
      // unicode-shield default.
      code: 'const el = <div>{username}</div>',
      options: [{autoImport: {name: 'cleanText', source: '~/utils/text'}}],
      output: "import {cleanText} from '~/utils/text';\n\nconst el = <div>{cleanText(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // A misconfigured autoImport.name that isn't a valid identifier (a
      // package-style dash, here) can't be spliced into generated code
      // safely, so the fix is withheld entirely rather than emitting
      // invalid JS. The violation is still reported.
      code: 'const el = <div>{username}</div>',
      options: [{autoImport: {name: 'sanitize-text', source: 'unicode-shield'}}],
      output: null,
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // autoImport.source containing a single quote must not break out of
      // the generated import's string literal.
      code: 'const el = <div>{username}</div>',
      options: [{autoImport: {name: 'sanitize', source: "weird's-package"}}],
      output: "import {sanitize} from 'weird\\'s-package';\n\nconst el = <div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // A `import type {...}` from unicode-shield binds no runtime value
      // (TypeScript erases it), so it must never be treated as a merge
      // target: a real, separate value import is inserted instead.
      code: "import type {ScanResult} from 'unicode-shield'\nconst el = <div>{username}</div>",
      languageOptions: typescriptLanguageOptions,
      output:
        "import type {ScanResult} from 'unicode-shield'\nimport {sanitize} from 'unicode-shield';\nconst el = <div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // Same idea per-specifier: `type Foo` inside an otherwise-normal value
      // import binds no runtime value either, so it doesn't count as
      // sanitize already being imported, and isn't a valid merge target.
      code: "import {type Foo, scan} from 'unicode-shield'\nconst el = <div>{username}</div>",
      languageOptions: typescriptLanguageOptions,
      output:
        "import {type Foo, scan, sanitize} from 'unicode-shield'\nconst el = <div>{sanitize(username)}</div>",
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
  ],
})

describe('require-sanitized-text --fix, multi-pass convergence', () => {
  // RuleTester's `output` only ever reflects a single autofix pass (see the
  // "both a risky child and a risky attribute" case above, where only the
  // first violation's shared import insertion wins that pass). Real
  // `eslint --fix` from the CLI or an editor re-lints and re-fixes
  // iteratively until nothing changes, so this uses the Linter directly to
  // confirm what actually ships to users: every violation ends up wrapped,
  // and only one import statement is ever inserted, not one per violation.
  it('fixes every violation in the file, sharing a single inserted import', () => {
    const linter = new Linter()
    const {output, messages} = linter.verifyAndFix(
      '<img alt={user.bio} title={user.displayName} />',
      {
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: {ecmaFeatures: {jsx: true}},
        },
        plugins: {custom: {rules: {'require-sanitized-text': rule}}},
        rules: {'custom/require-sanitized-text': 'error'},
      },
    )

    expect(output).toBe(
      "import {sanitize} from 'unicode-shield';\n\n<img alt={sanitize(user.bio)} title={sanitize(user.displayName)} />",
    )
    expect(messages).toEqual([])
  })

  it('still converges with three violations sharing one import, not two', () => {
    const linter = new Linter()
    const {output, messages} = linter.verifyAndFix(
      '<img alt={user.bio} title={user.displayName} aria-label={user.nickname} />',
      {
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: {ecmaFeatures: {jsx: true}},
        },
        plugins: {custom: {rules: {'require-sanitized-text': rule}}},
        rules: {'custom/require-sanitized-text': 'error'},
      },
    )

    expect(output).toBe(
      "import {sanitize} from 'unicode-shield';\n\n" +
        '<img alt={sanitize(user.bio)} title={sanitize(user.displayName)} aria-label={sanitize(user.nickname)} />',
    )
    expect(messages).toEqual([])
    expect(output?.match(/^import/gm)).toHaveLength(1)
  })
})
