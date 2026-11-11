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
  Ein Desktop-Launcher für <a href="https://github.com/skyhook-io/radar">Radar</a> mit Anmeldung über <a href="https://goteleport.com/">Teleport</a> in der App.
</p>

Captain startet [Radar](https://github.com/skyhook-io/radar) (`radar` / `kubectl-radar`) lokal und meldet dich über die [`tsh`](https://goteleport.com/docs/reference/cli/tsh/)-CLI bei [Teleport](https://goteleport.com/) an. Fehlt die Sitzung, ist sie abgelaufen oder widerrufen, öffnet Captain die Anmeldung in der App. Passwort, Security-Key und Einmalcode bleiben dort. Kein Browserfenster und kein Teleport Connect.

Nach der Anmeldung kann Captain alle Kubernetes-Cluster laden, auf die dein Teleport-Benutzer Zugriff hat.

## Was installiert sein muss

Captain liefert Radar und `tsh` nicht mit. Beides muss schon auf dem Rechner liegen, im `PATH` oder in den Captain-Einstellungen (`Cmd/Ctrl + ,`).

| Werkzeug | Warum |
| --- | --- |
| [`tsh`](https://goteleport.com/docs/installation/) | Führt die Teleport-Anmeldung aus und schreibt den Cluster-Zugriff. Das System-Binary behält die Hardware-Key-Unterstützung. |
| [`radar`](https://github.com/skyhook-io/radar) oder `kubectl-radar` | Die Kubernetes-Oberfläche, die Captain einbettet. |

Captain liest die Cluster aus der vorhandenen Kubeconfig (`~/.kube/config` oder `KUBECONFIG`).

## Captain installieren

Lade das Paket für dein System von den [Releases](https://github.com/dech-nik/Captain/releases). Die App ist nicht signiert, beim ersten Start kann das System nachfragen.

**macOS.** Die `.dmg` öffnen und Captain nach Programme ziehen. Oder das `.zip` entpacken und `Captain.app` dorthin legen. Blockiert macOS die App, per Rechtsklick öffnen und bestätigen. Alternativ: `xattr -dr com.apple.quarantine "/Applications/Captain.app"`.

**Windows.** Den Installer (`.exe`) starten. Den Ordner kannst du selbst wählen. Captain danach über das Startmenü öffnen.

**Linux.** Für das `.deb`: `sudo apt install ./Captain_*.deb`. Für das AppImage: `chmod +x Captain-*.AppImage` und die Datei starten.

Danach `tsh` und `radar` wie oben installieren und Captain öffnen.

## So funktioniert es

Radar spricht nur mit einem lokalen Proxy. Der Proxy benutzt deine echte Kubeconfig und die Teleport-Zugangsdaten. Schlagen die fehl, fordert Captain die Anmeldung an und verbindet Radar danach neu. Ein normales Kubernetes-Berechtigungsproblem bleibt ein Berechtigungsproblem. Ein unerreichbarer Cluster bleibt offline.

## Lizenzen

Der eigene Code von Captain steht unter [0BSD](LICENSE): für diesen Code gibt es keine Pflichten.

Bibliotheken, die in der App stecken, sind nur MIT, BSD, ISC oder Apache-2.0. Kein Copyleft. Die Texte liegen in [`licenses/`](licenses/). [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) ordnet jeder Komponente ihre Datei zu. Beides bleibt, weil mehrere Komponenten denselben Lizenznamen tragen, aber nicht denselben Copyright-Hinweis.

`tsh` und Radar sind nicht im Download enthalten. Sie laufen aus deiner Installation, Captain gibt sie nicht weiter.
