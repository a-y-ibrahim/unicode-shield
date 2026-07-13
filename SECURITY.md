# Security policy

## Reporting a vulnerability

Please report security issues privately using
[GitHub's private vulnerability reporting](https://github.com/a-y-ibrahim/unicode-shield/security/advisories/new)
for this repository, rather than opening a public issue.

Include:

- The affected version
- A minimal input string that reproduces the issue (as code points, e.g.
  `U+202E`, since the actual character may not survive copy/paste intact)
- What you expected `scan()`/`sanitize()`/`isSafe()` (or, for confusables,
  `getSkeleton()`/`areConfusable()`/`detectMixedScript()`) to do, and what
  they actually did

I will acknowledge reports within a few days.

## Supported versions

Only the latest published version is supported. This project is young and
has no long-term-support branches yet.

## Scope

`unicode-shield` detects and strips a specific, documented set of Unicode
code points (see the threat categories table in the README), and separately
detects visual confusables and mixed-script spoofing against Unicode's own
UTS #39 security data (`unicode-shield/confusables`, see the README section
on it). A missed detection, false positive, or bypass in either part is in
scope. It is not a general-purpose content filter or profanity filter;
reports outside that scope will likely be closed as out of scope rather
than as a vulnerability, but are still welcome as feature requests.
