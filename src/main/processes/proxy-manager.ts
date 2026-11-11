import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import type { ProxyInboundCommand, ProxyOutboundEvent, ProxyReadyEvent } from '@shared/types'

export class ProxyManager extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private readyInfo: ProxyReadyEvent | null = null
  private stopping = false

  constructor(private readonly binaryPath: string) {
    super()
  }

  public getReadyInfo(): ProxyReadyEvent | null {
    return this.readyInfo
  }

  public async start(): Promise<ProxyReadyEvent> {
    if (this.proc) {
      await this.stop()
    }
    this.stopping = false

    return new Promise<ProxyReadyEvent>((resolve, reject) => {
      let settled = false
      const child = spawn(this.binaryPath, [], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.proc = child

      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        try {
          const evt = JSON.parse(trimmed) as ProxyOutboundEvent
          if (evt.type === 'proxy:ready') {
            this.readyInfo = evt
            if (!settled) {
              settled = true
              resolve(evt)
            }
          }
          this.emit('event', evt)
        } catch {
          // Ignore malformed stdout lines
        }
      })

      const errRl = createInterface({ input: child.stderr })
      errRl.on('line', (line) => {
        console.error(`[k8s-proxy] ${line}`)
      })

      child.once('error', (err) => {
        if (!settled) {
          settled = true
          reject(err)
        }
        this.emit('error', err)
      })

      child.once('exit', (code, signal) => {
        this.proc = null
        if (!settled) {
          settled = true
          reject(new Error(`k8s-proxy exited before ready (code=${code}, signal=${signal})`))
        } else if (!this.stopping) {
          this.emit('unexpected-exit', { code, signal })
        }
      })

      setTimeout(() => {
        if (!settled) {
          settled = true
          this.stop().catch(() => {})
          reject(new Error('Timed out waiting for k8s-proxy ready event'))
        }
      }, 10000)
    })
  }

  public sendCommand(cmd: ProxyInboundCommand): void {
    if (!this.proc || !this.proc.stdin.writable) return
    try {
      this.proc.stdin.write(`${JSON.stringify(cmd)}\n`)
    } catch {
      // Ignore write failures during shutdown
    }
  }

  public async stop(): Promise<void> {
    this.stopping = true
    const child = this.proc
    this.proc = null
    this.readyInfo = null
    if (!child) return

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already dead
        }
        resolve()
      }, 2500)

      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })

      try {
        child.stdin.end()
        child.kill('SIGTERM')
      } catch {
        clearTimeout(killTimer)
        resolve()
      }
    })
  }
}
