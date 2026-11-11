# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-11

### Added

- Desktop launcher for Radar with native Teleport sign-in through the `tsh` CLI.
- In-app login flow covering password, security-key, and one-time-code authentication — no browser window, no Teleport Connect.
- Kubernetes cluster discovery for every cluster the signed-in Teleport user is allowed to use.
- Local proxy that bridges Radar to the machine's kubeconfig and Teleport credentials.
- Cross-platform packages: macOS (`.dmg`, `.zip`), Windows (NSIS installer), and Linux (`.AppImage`, `.deb`).
- Release pipeline that builds and publishes all platform packages on a `v*` tag push.

[1.0.0]: https://github.com/dech-nik/Captain/releases/tag/v1.0.0
