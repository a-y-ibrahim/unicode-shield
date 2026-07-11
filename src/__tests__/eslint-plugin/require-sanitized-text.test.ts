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

    // JSX attributes are out of scope for v1: only rendered children are checked.
    '<div title={handle}>{count}</div>',
    '<input onChange={handleChange} />',

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
  ],
})
