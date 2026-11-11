import { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'

export class RadarManager extends EventEmitter {
  private proc: ChildProcess | null = null
  private port: number | null = null
  private stopping = false

  public getBaseUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}` : null
  }

  public async start(radarBinaryPath: string, syntheticKubeconfigPath: string): Promise<string> {
    if (this.proc) {
      await this.stop()
    }
    this.stopping = false

    const port = await allocateFreeLoopbackPort()
    this.port = port

    // Strip KUBECONFIG from Radar's environment so Radar exclusively reads our synthetic kubeconfig
    // and routes 100% of Kubernetes API traffic through the local Go reverse proxy.
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env }
    delete cleanEnv.KUBECONFIG

    const args = [
      `--kubeconfig=${syntheticKubeconfigPath}`,
      '--listen-address=127.0.0.1',
      `--port=${port}`,
      '--no-browser',
      '--no-mcp'
    ]

    const child = spawn(radarBinaryPath, args, {
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = child

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        console.log(`[radar] ${line}`)
      })
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on('line', (line) => {
        console.error(`[radar] ${line}`)
      })
    }

    child.once('exit', (code, signal) => {
      this.proc = null
      if (!this.stopping) {
        this.emit('unexpected-exit', { code, signal })
      }
    })

    const baseUrl = `http://127.0.0.1:${port}`
    await waitForRadarHealth(baseUrl, child, 20000)
    return baseUrl
  }

  /**
   * Triggers an immediate in-place reconnection on Radar after Teleport login completes,
   * avoiding any background polling wait.
   */
  public async triggerConnectionRetry(): Promise<boolean> {
    const baseUrl = this.getBaseUrl()
    if (!baseUrl) return false

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(`${baseUrl}/api/connection/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      })
      clearTimeout(timeout)
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Switches Radar's active Kubernetes context (e.g. after `tsh kube login --all` adds Teleport
   * clusters to a kubeconfig that previously only had a stopped local kind/minikube context).
   */
  public async switchContext(contextName: string): Promise<boolean> {
    const baseUrl = this.getBaseUrl()
    if (!baseUrl || !contextName) return false

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(`${baseUrl}/api/contexts/${encodeURIComponent(contextName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      })
      clearTimeout(timeout)
      return res.ok
    } catch {
      return false
    }
  }

  public async stop(): Promise<void> {
    this.stopping = true
    const child = this.proc
    this.proc = null
    this.port = null
    if (!child) return

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
        resolve()
      }, 3000)

      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })

      try {
        child.kill('SIGTERM')
      } catch {
        clearTimeout(killTimer)
        resolve()
      }
    })
  }
}

async function allocateFreeLoopbackPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Failed to resolve ephemeral port')))
      }
    })
  })
}

async function waitForRadarHealth(baseUrl: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let exitedError: Error | null = null

  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    exitedError = new Error(`Radar process exited during startup (code=${code}, signal=${signal})`)
  }
  child.once('exit', onExit)

  try {
    while (Date.now() < deadline) {
      if (exitedError) throw exitedError
      try {
        const res = await fetch(`${baseUrl}/api/health`)
        if (res.ok || res.status < 500) {
          return
        }
      } catch {
        // Server still binding listener
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`Timed out waiting for Radar HTTP server at ${baseUrl}`)
  } finally {
    child.removeListener('exit', onExit)
  }
}
