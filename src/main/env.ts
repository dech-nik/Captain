import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { CaptainPreferences, TeleportMfaMode } from '@shared/types'

export interface PersistedSettings {
  radarPath?: string
  tshPath?: string
  lastTeleportProxy?: string
  lastTeleportUser?: string
  mfaMode?: TeleportMfaMode
  syncAllClusters?: boolean
  autoSelectTeleportCluster?: boolean
  showTerminalByDefault?: boolean
}

const SETTINGS_FILE = 'captain-settings.json'
const LEGACY_SETTINGS_FILE = 'launcher-settings.json'

const CAPTURED_SHELL_KEYS = [
  'PATH',
  'KUBECONFIG',
  'SSH_AUTH_SOCK',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY'
]

const CAPTURED_SHELL_PREFIXES = ['TELEPORT_', 'AWS_', 'CLOUDSDK_', 'AZURE_']

/**
 * Enriches `process.env` with environment variables from the user's login shell on macOS/Linux
 * so GUI launches from Dock/Desktop find `radar`, `tsh`, and multi-file `KUBECONFIG` settings.
 */
export function enrichProcessEnvFromLoginShell(): void {
  if (process.platform === 'win32') {
    appendCommonPaths('')
    return
  }

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const startMarker = '__CAPTAIN_ENV_START__'
  const endMarker = '__CAPTAIN_ENV_END__'

  const scriptLines = [
    `printf '%s\\000' '${startMarker}'`,
    ...CAPTURED_SHELL_KEYS.map((k) => `printf '%s\\000' "${k}=$${k}"`),
    'command env -0 || true',
    `printf '%s\\000' '${endMarker}'`
  ]

  try {
    const raw = execFileSync(shell, ['-l', '-i', '-c', scriptLines.join('\n')], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const startIdx = raw.indexOf(`${startMarker}\0`)
    const endIdx = raw.lastIndexOf(`\0${endMarker}`)
    if (startIdx !== -1 && endIdx > startIdx) {
      const slice = raw.slice(startIdx + startMarker.length + 1, endIdx)
      const entries = slice.split('\0')
      const captured: Record<string, string> = {}

      for (const entry of entries) {
        const eq = entry.indexOf('=')
        if (eq <= 0) continue
        const key = entry.slice(0, eq)
        const val = entry.slice(eq + 1)
        if (!val) continue
        if (
          CAPTURED_SHELL_KEYS.includes(key) ||
          CAPTURED_SHELL_PREFIXES.some((prefix) => key.startsWith(prefix))
        ) {
          captured[key] = val
        }
      }

      appendCommonPaths(captured.PATH || '')

      for (const [k, v] of Object.entries(captured)) {
        if (k === 'PATH') continue
        if (!process.env[k] && v) {
          process.env[k] = v
        }
      }
      return
    }
  } catch {
    // Fallback to common installation paths if login shell invocation fails or times out
  }

  appendCommonPaths('')
}

function appendCommonPaths(shellPath: string): void {
  const currentParts = (process.env.PATH || '').split(delimiter).filter(Boolean)
  const shellParts = shellPath.split(delimiter).filter(Boolean)
  const home = homedir()

  const fallbackDirs =
    process.platform === 'win32'
      ? [
          join(process.env.ProgramFiles || 'C:\\Program Files', 'Teleport'),
          join(home, 'AppData', 'Local', 'Programs', 'Teleport'),
          join(home, '.krew', 'bin')
        ]
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          '/usr/sbin',
          '/sbin',
          join(home, '.krew', 'bin'),
          join(home, '.local', 'bin'),
          join(home, 'go', 'bin')
        ]

  const merged = new Set<string>([...shellParts, ...currentParts, ...fallbackDirs])
  process.env.PATH = Array.from(merged).join(delimiter)
}

export function isExecutableFile(filePath: string): boolean {
  if (!filePath || !existsSync(filePath)) return false
  try {
    if (process.platform === 'win32') {
      accessSync(filePath, constants.R_OK)
      return true
    }
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findBinaryInPath(candidates: string[]): string | null {
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']

  for (const name of candidates) {
    if (name.includes('/') || name.includes('\\')) {
      if (isExecutableFile(name)) return name
      continue
    }
    for (const dir of pathDirs) {
      for (const ext of exts) {
        const full = join(dir, `${name}${ext}`)
        if (isExecutableFile(full)) {
          return full
        }
      }
    }
  }
  return null
}

export function resolveRadarBinary(customPath?: string): string | null {
  if (customPath && customPath.trim() !== '') {
    return isExecutableFile(customPath.trim()) ? customPath.trim() : null
  }
  return findBinaryInPath(['radar', 'kubectl-radar'])
}

export function resolveTshBinary(customPath?: string): string | null {
  if (customPath && customPath.trim() !== '') {
    return isExecutableFile(customPath.trim()) ? customPath.trim() : null
  }
  return findBinaryInPath(['tsh'])
}

export function resolveBundledProxyBinary(
  isPackaged: boolean,
  resourcesPath: string,
  appPath: string
): string {
  const binName = process.platform === 'win32' ? 'k8s-proxy.exe' : 'k8s-proxy'
  if (isPackaged) {
    return join(resourcesPath, 'bin', binName)
  }
  return join(appPath, 'resources', 'bin', binName)
}

export function computeCaptainPreferences(settings: PersistedSettings): CaptainPreferences {
  const validMfa: TeleportMfaMode[] = ['auto', 'cross-platform', 'platform', 'otp']
  const mfaMode: TeleportMfaMode =
    settings.mfaMode && validMfa.includes(settings.mfaMode) ? settings.mfaMode : 'auto'

  return {
    defaultTeleportProxy: settings.lastTeleportProxy || '',
    defaultTeleportUser: settings.lastTeleportUser || '',
    mfaMode,
    syncAllClusters: settings.syncAllClusters ?? true,
    autoSelectTeleportCluster: settings.autoSelectTeleportCluster ?? true,
    showTerminalByDefault: settings.showTerminalByDefault ?? false
  }
}

export function loadPersistedSettings(userDataDir: string): PersistedSettings {
  const primary = join(userDataDir, SETTINGS_FILE)
  const sameDirLegacy = join(userDataDir, LEGACY_SETTINGS_FILE)
  const siblingLegacy = join(dirname(userDataDir), 'radar-launcher', LEGACY_SETTINGS_FILE)

  for (const candidate of [primary, sameDirLegacy, siblingLegacy]) {
    try {
      if (existsSync(candidate)) {
        const loaded = JSON.parse(readFileSync(candidate, 'utf8')) as PersistedSettings
        if (candidate !== primary) {
          savePersistedSettings(userDataDir, loaded)
        }
        return loaded
      }
    } catch {
      // ignore unreadable candidate
    }
  }
  return {}
}

export function savePersistedSettings(userDataDir: string, settings: PersistedSettings): void {
  const file = join(userDataDir, SETTINGS_FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })
}
