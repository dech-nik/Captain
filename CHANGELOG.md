# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-13

### Added

- Five-slot palette of saved views, with shortcuts and a settings section.
- Opening a saved view in place over the live Radar workspace, with that workspace blurred behind Captain overlays.
- Dragging a saved view onto the current view to open it. The card turns green over the current view and red over the bin.
- Live cluster tracking: the local proxy reports the cluster Radar is using, so Captain follows that cluster without polling.

## [1.0.0] - 2026-11-11

### Added

- Desktop launcher for Radar with native Teleport sign-in through the `tsh` CLI.
- In-app login flow covering password, security-key, and one-time-code authentication — no browser window, no Teleport Connect.
- Kubernetes cluster discovery for every cluster the signed-in Teleport user is allowed to use.
- Local proxy that bridges Radar to the machine's kubeconfig and Teleport credentials.
- Cross-platform packages: macOS (`.dmg`, `.zip`), Windows (NSIS installer), and Linux (`.AppImage`, `.deb`).
- Release pipeline that builds and publishes all platform packages on a `v*` tag push.

[1.1.0]: https://github.com/dech-nik/Captain/releases/tag/v1.1.0
[1.0.0]: https://github.com/dech-nik/Captain/releases/tag/v1.0.0
