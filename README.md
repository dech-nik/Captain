<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="build/logo-horizontal-dark.svg" />
    <img alt="Captain" src="build/logo-horizontal.svg" height="72" />
  </picture>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.de.md">Deutsch</a>
</p>

<p align="center">
  A desktop launcher for <a href="https://github.com/skyhook-io/radar">Radar</a> with in-app <a href="https://goteleport.com/">Teleport</a> sign-in.
</p>

Captain starts [Radar](https://github.com/skyhook-io/radar) (`radar` / `kubectl-radar`) on your machine and signs you in to [Teleport](https://goteleport.com/) through the [`tsh`](https://goteleport.com/docs/reference/cli/tsh/) CLI. When a Teleport session is missing, expired, or revoked, Captain opens a sign-in screen inside the app. Password, security key, and one-time code stay in that screen. No browser window and no Teleport Connect.

After a successful login, Captain can load every Kubernetes cluster your Teleport user is allowed to use.

## What you need installed

Captain does not ship Radar or `tsh`. Both must already be on the machine, on `PATH`, or set in Captain settings (`Cmd/Ctrl + ,`).

| Tool | Why |
| --- | --- |
| [`tsh`](https://goteleport.com/docs/installation/) | Performs the Teleport login and writes cluster access. Using the system binary keeps hardware-key support intact. |
| [`radar`](https://github.com/skyhook-io/radar) or `kubectl-radar` | The Kubernetes workspace Captain embeds. |

A working kubeconfig (`~/.kube/config` or `KUBECONFIG`) is what Captain reads for cluster context.

## Install Captain

Download the package for your machine from the [releases](https://github.com/dech-nik/Captain/releases). The app is not code-signed, so the operating system may ask you to confirm the first launch.

**macOS.** Open the `.dmg` and drag Captain to Applications. Or unzip the `.zip` and move `Captain.app` there. If macOS blocks the app, right-click it, choose Open, and confirm. You can also run `xattr -dr com.apple.quarantine "/Applications/Captain.app"`.

**Windows.** Run the installer (`.exe`). You choose the folder. Start Captain from the Start menu.

**Linux.** For the `.deb`: `sudo apt install ./Captain_*.deb`. For the AppImage: `chmod +x Captain-*.AppImage` and run that file.

Then install `tsh` and `radar` as above, and open Captain.

## How it works

Radar talks only to a local proxy. That proxy uses your real kubeconfig and Teleport credentials. If those credentials fail, Captain asks you to sign in, then reconnects Radar. A normal Kubernetes permission error stays a permission error. A cluster that is simply unreachable stays offline.

## Licenses

Captain’s own code is [0BSD](LICENSE): no obligations on that code.

Libraries that ship inside the app are MIT, BSD, ISC, or Apache-2.0 only. There is no copyleft. Full texts are in [`licenses/`](licenses/). [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) says which component uses which file. Both stay, because several components share a license name but not the same copyright notice.

`tsh` and Radar are not included in the download. They run from your installation, so Captain does not redistribute them.
