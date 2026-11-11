import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface TshStatusSnapshot {
  loggedIn: boolean
  proxyAddr?: string
  teleportCluster?: string
  username?: string
  hasKubeClusters: boolean
}

interface TshProfileJson {
  /** Older tsh builds. */
  proxy_url?: string
  /** tsh v18 `tsh status -f json`. */
  profile_url?: string
  cluster?: string
  username?: string
  kube_enabled?: boolean
  kubernetes_enabled?: boolean
  kubernetes_cluster?: string
  kubernetes_clusters?: unknown[]
}

interface TshStatusJson {
  active?: TshProfileJson
  profiles?: TshProfileJson[]
}

/**
 * Runs a single one-shot `tsh status -f json` check (no polling) to inspect
 * whether an active Teleport session exists and extract generic proxy hints if available.
 */
export async function inspectTshStatusOnce(tshBinaryPath: string): Promise<TshStatusSnapshot> {
  try {
    const { stdout } = await execFileAsync(tshBinaryPath, ['status', '-f', 'json'], {
      timeout: 3500,
      env: { ...process.env, BROWSER: 'none' }
    })
    return snapshotFromTshStatus(JSON.parse(stdout) as TshStatusJson, true)
  } catch (err) {
    // When expired or logged out, `tsh status -f json` exits with code 1,
    // though sometimes stdout still contains expired profile JSON!
    const maybeStdout =
      err && typeof err === 'object' && 'stdout' in err && typeof err.stdout === 'string'
        ? err.stdout.trim()
        : ''
    if (maybeStdout.startsWith('{')) {
      try {
        const parsed = JSON.parse(maybeStdout) as TshStatusJson
        const profile = parsed.active ?? parsed.profiles?.[0]
        if (profileProxy(profile)) {
          return snapshotFromTshStatus(parsed, false)
        }
      } catch {
        // ignore JSON parse failure
      }
    }

    return {
      loggedIn: false,
      hasKubeClusters: false
    }
  }
}

/** Pure parser so tsh v18 `profile_url` is not mistaken for a logged-out session. */
export function snapshotFromTshStatus(parsed: TshStatusJson, commandSucceeded: boolean): TshStatusSnapshot {
  const active = parsed.active
  const activeProxy = profileProxy(active)
  if (commandSucceeded && active && activeProxy) {
    return {
      loggedIn: true,
      proxyAddr: activeProxy,
      teleportCluster: active.cluster,
      username: cleanStatusUser(active.username),
      hasKubeClusters: hasKubeClusters(active)
    }
  }

  const fallback = active ?? parsed.profiles?.[0]
  return {
    loggedIn: false,
    proxyAddr: profileProxy(fallback),
    teleportCluster: fallback?.cluster,
    username: cleanStatusUser(fallback?.username),
    hasKubeClusters: false
  }
}

function profileProxy(profile?: TshProfileJson): string | undefined {
  const raw = profile?.profile_url || profile?.proxy_url
  return raw ? stripProtocol(raw) : undefined
}

function hasKubeClusters(profile: TshProfileJson): boolean {
  if (Array.isArray(profile.kubernetes_clusters) && profile.kubernetes_clusters.length > 0) return true
  return Boolean(profile.kubernetes_cluster && profile.kubernetes_cluster.trim() !== '')
}

function stripProtocol(rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

function cleanStatusUser(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
