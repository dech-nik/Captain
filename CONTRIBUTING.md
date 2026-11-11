# Contributing to Captain

Thanks for your interest in contributing. This document describes how the project is developed so your changes fit right in.

## Prerequisites

- Node.js 22+ and npm 10+
- Go 1.26+ (for the local proxy)
- `npm install` sets up the Electron app dependencies

## Daily workflow

```bash
npm run dev        # build the proxy and start the app in dev mode
npm test           # TypeScript / React test suite (Vitest)
npm run test:go    # Go test suite for the proxy
npm run test:all   # both suites
```

## Branching model

- `main` is the stable branch. It should build and pass tests at all times.
- All work happens on short-lived feature branches created from `main`:
  - `feat/<topic>` — new functionality
  - `fix/<topic>` — bug fixes
  - `docs/<topic>` — documentation only
  - `chore/<topic>` — tooling, CI, refactors
- Open a pull request against `main` even for small changes; it keeps the history reviewable.

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short summary in imperative mood
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`. The scope is optional but recommended, e.g. `feat(teleport): retry status polling on session expiry`.

## Versioning and releases

- Versions follow [Semantic Versioning](https://semver.org/): breaking changes bump the major version, new features the minor version, fixes the patch version.
- A release is cut by pushing a tag `vX.Y.Z` pointing at a `main` commit.
- The Release workflow builds packages for macOS, Windows, and Linux and publishes them as a GitHub release with generated notes.
- Bump `version` in `package.json` and add a `CHANGELOG.md` entry in the same pull request that prepares the release.

## Reporting issues

Please include the platform, Captain version, `tsh` version, and the steps to reproduce.
