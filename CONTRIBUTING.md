# Contributing

## Pull requests

Open PRs against `main`.

**PR title must follow [Conventional Commits](https://www.conventionalcommits.org/):**
this repo squash-merges, so the PR title becomes the commit message on `main`, and
that message is what decides the next version and changelog entry (see Releasing
below). [`pr-title-lint.yml`](.github/workflows/pr-title-lint.yml) checks this on
every PR and fails the check if it doesn't match.

- `fix: ...` - a bug fix, ships as a **patch** release.
- `feat: ...` - a new capability, ships as a **minor** release (this package is
  pre-1.0, so even a breaking `feat!:`/`fix!:` stays a minor bump rather than
  jumping to `1.0.0` - reaching `1.0.0` is a deliberate decision, not a side effect
  of one commit's prefix).
- `feat!: ...` or `fix!: ...` (bang before the colon) - a breaking change. Explain
  what breaks in the PR description.
- Anything else conventional (`docs:`, `chore:`, `refactor:`, `test:`, `ci:`, ...) is
  accepted but does not trigger a release on its own.

Pick the prefix by what the diff actually does, not by how the change was described
in conversation - a PR titled `fix:` that actually adds a new optional parameter is
just as wrong as an incorrectly-labeled npm version, since both mislead a consumer
about what they're getting.

## Releasing

Releasing is automated by
[`release-please`](https://github.com/googleapis/release-please), Google's own
release-automation tool, via
[`.github/workflows/release-please.yml`](.github/workflows/release-please.yml):

1. As PRs with conventional-commit titles land on `main`, release-please keeps an
   open "Release PR" up to date: it computes the next version from the accumulated
   `fix:`/`feat:`/`feat!:` prefixes and writes the corresponding `CHANGELOG.md`
   section from the actual PR titles/descriptions.
2. Nothing publishes automatically just from merging regular PRs. Publishing
   happens only when a maintainer reviews and merges that Release PR - this is the
   explicit go-ahead point, review the generated version bump and changelog there.
3. Merging the Release PR tags the release and publishes a GitHub Release, which
   triggers [`.github/workflows/publish.yml`](.github/workflows/publish.yml)
   automatically: it type-checks, tests, builds, and publishes to npm with a
   [provenance attestation](https://docs.npmjs.com/generating-provenance-statements).

Do not run `npm publish` or hand-edit `version` in `package.json` directly; the
Release PR is the only path that changes it, and the workflow is the only publish
path.

This requires two repository secrets:

- `RELEASE_PLEASE_TOKEN`: a fine-grained PAT (not the default `GITHUB_TOKEN` - GitHub
  blocks the default token's own actions from triggering other workflows, which
  would silently prevent the Release PR's merge from firing `publish.yml`) scoped to
  `Contents`, `Issues`, and `Pull requests`: read and write on this repo.
- `NPM_TOKEN`: an npm **Automation** token (Account Settings → Access Tokens →
  Generate New Token → Automation on npmjs.com). Automation tokens are built to
  publish from CI without an interactive 2FA prompt, and cannot change account or
  org settings.

Add both under Settings → Secrets and variables → Actions in the GitHub repo.
