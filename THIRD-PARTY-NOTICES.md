# Third-party notices

This file is the attribution index. The directory [`licenses/`](licenses/) holds the upstream license texts in full, one file per component.

Both are required:

- `licenses/` is the legal text. Several components share a license name (MIT, Apache-2.0, BSD-3-Clause) but not the same copyright notice. A single shared copy of "the MIT license" would drop those notices.
- This file records which shipped component uses which text, and which components are used but not redistributed. That mapping is not inside the license files themselves.

Captain's own code is under the [0BSD license](LICENSE) and is not listed below.

## Shipped with the application

| Component | License file |
| --- | --- |
| electron | [licenses/electron.MIT.txt](licenses/electron.MIT.txt) |
| node-pty | [licenses/node-pty.MIT.txt](licenses/node-pty.MIT.txt) |
| node-addon-api | [licenses/node-addon-api.MIT.txt](licenses/node-addon-api.MIT.txt) |
| react | [licenses/react.MIT.txt](licenses/react.MIT.txt) |
| react-dom | [licenses/react-dom.MIT.txt](licenses/react-dom.MIT.txt) |
| scheduler | [licenses/scheduler.MIT.txt](licenses/scheduler.MIT.txt) |
| @xterm/xterm | [licenses/xterm.MIT.txt](licenses/xterm.MIT.txt) |
| Go standard library | [licenses/go-stdlib.BSD-3-Clause.txt](licenses/go-stdlib.BSD-3-Clause.txt), [licenses/go-stdlib.PATENTS.txt](licenses/go-stdlib.PATENTS.txt) |
| k8s.io/client-go | [licenses/k8s.io-client-go.Apache-2.0.txt](licenses/k8s.io-client-go.Apache-2.0.txt) |
| k8s.io/apimachinery | [licenses/k8s.io-apimachinery.Apache-2.0.txt](licenses/k8s.io-apimachinery.Apache-2.0.txt) |
| k8s.io/klog | [licenses/k8s.io-klog.Apache-2.0.txt](licenses/k8s.io-klog.Apache-2.0.txt) |
| k8s.io/kube-openapi | [licenses/k8s.io-kube-openapi.Apache-2.0.txt](licenses/k8s.io-kube-openapi.Apache-2.0.txt) |
| k8s.io/utils | [licenses/k8s.io-utils.Apache-2.0.txt](licenses/k8s.io-utils.Apache-2.0.txt) |
| sigs.k8s.io/json | [licenses/sigs.k8s.io-json.Apache-2.0.txt](licenses/sigs.k8s.io-json.Apache-2.0.txt) |
| sigs.k8s.io/randfill | [licenses/sigs.k8s.io-randfill.Apache-2.0.txt](licenses/sigs.k8s.io-randfill.Apache-2.0.txt) |
| sigs.k8s.io/structured-merge-diff | [licenses/sigs.k8s.io-structured-merge-diff.Apache-2.0.txt](licenses/sigs.k8s.io-structured-merge-diff.Apache-2.0.txt) |
| sigs.k8s.io/yaml | [licenses/sigs.k8s.io-yaml.MIT.txt](licenses/sigs.k8s.io-yaml.MIT.txt) |
| github.com/json-iterator/go | [licenses/json-iterator.MIT.txt](licenses/json-iterator.MIT.txt) |
| github.com/fxamacker/cbor | [licenses/fxamacker-cbor.MIT.txt](licenses/fxamacker-cbor.MIT.txt) |
| github.com/x448/float16 | [licenses/float16.MIT.txt](licenses/float16.MIT.txt) |
| go.yaml.in/yaml | [licenses/go.yaml.in-yaml.Apache-2.0.txt](licenses/go.yaml.in-yaml.Apache-2.0.txt) |
| github.com/go-logr/logr | [licenses/go-logr.Apache-2.0.txt](licenses/go-logr.Apache-2.0.txt) |
| github.com/modern-go/concurrent | [licenses/modern-go-concurrent.Apache-2.0.txt](licenses/modern-go-concurrent.Apache-2.0.txt) |
| github.com/modern-go/reflect2 | [licenses/modern-go-reflect2.Apache-2.0.txt](licenses/modern-go-reflect2.Apache-2.0.txt) |
| github.com/davecgh/go-spew | [licenses/go-spew.ISC.txt](licenses/go-spew.ISC.txt) |
| github.com/munnerz/goautoneg | [licenses/goautoneg.BSD-3-Clause.txt](licenses/goautoneg.BSD-3-Clause.txt) |
| github.com/spf13/pflag | [licenses/spf13-pflag.BSD-3-Clause.txt](licenses/spf13-pflag.BSD-3-Clause.txt) |
| gopkg.in/inf.v0 | [licenses/gopkg.in-inf.BSD-3-Clause.txt](licenses/gopkg.in-inf.BSD-3-Clause.txt) |
| golang.org/x/net | [licenses/golang.org-x-net.BSD-3-Clause.txt](licenses/golang.org-x-net.BSD-3-Clause.txt) |
| golang.org/x/oauth2 | [licenses/golang.org-x-oauth2.BSD-3-Clause.txt](licenses/golang.org-x-oauth2.BSD-3-Clause.txt) |
| golang.org/x/sys | [licenses/golang.org-x-sys.BSD-3-Clause.txt](licenses/golang.org-x-sys.BSD-3-Clause.txt) |
| golang.org/x/term | [licenses/golang.org-x-term.BSD-3-Clause.txt](licenses/golang.org-x-term.BSD-3-Clause.txt) |
| golang.org/x/text | [licenses/golang.org-x-text.BSD-3-Clause.txt](licenses/golang.org-x-text.BSD-3-Clause.txt) |
| golang.org/x/time | [licenses/golang.org-x-time.BSD-3-Clause.txt](licenses/golang.org-x-time.BSD-3-Clause.txt) |

Electron also ships Chromium's own notices inside the application as `LICENSES.chromium.html`. That file comes from the Electron distribution and is not duplicated here.

## Used on the host, not shipped

`radar` (or `kubectl-radar`) and `tsh` are started from the machine they are already installed on. This repository does not contain their binaries or their license texts.
