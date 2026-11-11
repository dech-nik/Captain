import { existsSync, FSWatcher, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'

/**
 * Watches parent directories of resolved user kubeconfig files using Node's built-in `node:fs.watch`
 * (zero external Go/npm dependencies) and triggers a debounced callback when any kubeconfig changes.
 */
export class KubeconfigWatcher {
  private watchers: FSWatcher[] = []
  private debounceTimer: NodeJS.Timeout | null = null

  public start(onChange: () => void): void {
    this.stop()

    const rawEnv = process.env.KUBECONFIG
    const candidates =
      rawEnv && rawEnv.trim() !== ''
        ? rawEnv.split(delimiter).filter(Boolean)
        : [join(homedir(), '.kube', 'config')]

    const targetBasenamesByDir = new Map<string, Set<string>>()
    for (const candidate of candidates) {
      const abs = resolve(candidate.trim())
      const dir = dirname(abs)
      const base = basename(abs)
      if (!targetBasenamesByDir.has(dir)) {
        targetBasenamesByDir.set(dir, new Set())
      }
      targetBasenamesByDir.get(dir)?.add(base)
    }

    for (const [dir, names] of targetBasenamesByDir.entries()) {
      if (!existsSync(dir)) continue
      try {
        const w = watch(dir, { persistent: false }, (_eventType, filename) => {
          if (filename && !names.has(String(filename))) {
            return
          }
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
          }
          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            onChange()
          }, 250)
        })
        this.watchers.push(w)
      } catch {
        // Ignore non-watchable directory
      }
    }
  }

  public stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        // ignore
      }
    }
    this.watchers = []
  }
}
