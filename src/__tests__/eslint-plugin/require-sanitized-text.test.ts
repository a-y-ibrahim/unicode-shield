import {RuleTester} from 'eslint'
import {describe, it} from 'vitest'

import rule from '../../eslint-plugin/rules/require-sanitized-text'

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
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      code: '<div>{user.username}</div>',
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      code: '<div>{profile.displayName}</div>',
      errors: [{messageId: 'requireSanitize', data: {name: 'displayName'}}],
    },
    {
      // A destructured prop has no traceable sanitize() initializer, so it's
      // flagged exactly like any other unsanitized identifier.
      code: 'function Profile({username}) { return <div>{username}</div> }',
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // Traced back to its declaration, but that declaration never sanitizes.
      code: 'const bio = user.bio; const el = <div>{bio}</div>',
      errors: [{messageId: 'requireSanitize', data: {name: 'bio'}}],
    },
    {
      code: '<div>{secret}</div>',
      options: [{riskyNames: ['secret']}],
      errors: [{messageId: 'requireSanitize', data: {name: 'secret'}}],
    },
    {
      // Fragments are a distinct AST node from a plain element; must be
      // recognized as a children position too, not just JSXElement.
      code: '<>{username}</>',
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // The single most common real-world shape this rule needs to catch:
      // an unsanitized field rendered inside a .map() list callback.
      code: 'users.map(u => <li>{u.username}</li>)',
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      // sanitize() is called, but on a different variable: safeBio's own
      // declaration is untraced, so it's still flagged.
      code: 'const other = sanitize(x); const safeBio = user.bio; const el = <div>{safeBio}</div>',
      errors: [{messageId: 'requireSanitize', data: {name: 'safeBio'}}],
    },
    {
      // A statically known computed key (bracket notation) is just as
      // risky as dot notation and must not be a way to slip past the rule.
      code: '<div>{user["username"]}</div>',
      errors: [{messageId: 'requireSanitize', data: {name: 'username'}}],
    },
    {
      code: '<img alt={user.bio} />',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'alt'}}],
    },
    {
      code: '<div title={handle}>{count}</div>',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'handle', attribute: 'title'}}],
    },
    {
      code: '<input placeholder={handle} />',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'handle', attribute: 'placeholder'}}],
    },
    {
      // Hyphenated attribute names (JSX allows these as a special case)
      // must resolve the same way plain identifiers do.
      code: '<div aria-label={user.username} />',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'username', attribute: 'aria-label'}}],
    },
    {
      code: '<input value={user.nickname} />',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'nickname', attribute: 'value'}}],
    },
    {
      // Computed member access works the same in an attribute position as
      // it does in a child position.
      code: '<img alt={user["bio"]} />',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'alt'}}],
    },
    {
      // Attribute checking looks at the attribute name only, not the tag,
      // so a custom or third-party component (Avatar, Tooltip, ...) that
      // happens to accept a same-named prop is covered exactly like a
      // native HTML element.
      code: '<Avatar alt={user.bio} />',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'alt'}}],
    },
    {
      // riskyAttributes matching is case-insensitive, same as riskyNames.
      code: '<img ALT={user.bio} />',
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'bio', attribute: 'ALT'}}],
    },
    {
      // Both a risky child and a risky attribute on the same element are
      // reported independently.
      code: '<img alt={user.bio} title={user.displayName} />',
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
      errors: [{messageId: 'requireSanitizeAttribute', data: {name: 'username', attribute: 'data-testid'}}],
    },
  ],
})
