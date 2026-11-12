import { PALETTE_SLOT_COUNT, type ShortcutActionId, type ShortcutBindings } from './types'

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
  paletteMenu: 'CommandOrControl+P',
  openSettings: 'CommandOrControl+,',
  teleportLogin: 'CommandOrControl+Shift+L',
  reconnectCluster: 'CommandOrControl+Shift+R'
}

export interface ShortcutActionMeta {
  id: ShortcutActionId
  label: string
  description: string
}

export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
  {
    id: 'paletteMenu',
    label: 'Ansichts-Paletten',
    description: 'Blendet die horizontale Ansichts-Palette ein oder aus.'
  },
  {
    id: 'openSettings',
    label: 'Captain Einstellungen',
    description: 'Öffnet oder schließt die Einstellungen.'
  },
  {
    id: 'teleportLogin',
    label: 'Teleport-Anmeldung',
    description: 'Startet manuell eine neue Teleport-Authentifizierung.'
  },
  {
    id: 'reconnectCluster',
    label: 'Cluster-Verbindung erneuern',
    description: 'Lädt die Kubeconfig neu und verbindet den aktuellen Kontext erneut.'
  }
]

const RADAR_RESERVED_SHORTCUTS: Record<string, string> = {
  'CommandOrControl+K': 'Wird in Radar bereits für die globale Ressourcen-Suche genutzt.',
  'Control+Shift+D': 'Wird in Radar für das Diagnose-Fenster genutzt.',
  'CommandOrControl+Shift+D': 'Kann mit dem Radar-Diagnose-Kürzel kollidieren.'
}

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'OS',
  'Command',
  'Cmd'
])

function normalizeKeyToken(rawKey: string): string | null {
  const trimmed = rawKey.trim()
  if (!trimmed || MODIFIER_KEYS.has(trimmed)) return null

  const lower = trimmed.toLowerCase()
  switch (lower) {
    case ' ':
    case 'space':
    case 'spacebar':
      return 'Space'
    case 'plus':
    case '+':
      return 'Plus'
    case ',':
    case 'comma':
      return ','
    case '.':
    case 'period':
      return '.'
    case '/':
    case 'slash':
      return '/'
    case '-':
    case 'minus':
      return '-'
    case 'escape':
    case 'esc':
      return null
    case 'arrowup':
    case 'up':
      return 'Up'
    case 'arrowdown':
    case 'down':
      return 'Down'
    case 'arrowleft':
    case 'left':
      return 'Left'
    case 'arrowright':
    case 'right':
      return 'Right'
    case 'enter':
    case 'return':
      return null
    case 'tab':
      return null
    default:
      break
  }

  if (/^f([1-9]|1[0-2])$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase()
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export function sanitizeShortcutAccelerator(raw: string | undefined, fallback: string): string {
  if (!raw || typeof raw !== 'string') return fallback
  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return fallback

  let hasCmdOrCtrl = false
  let hasAlt = false
  let hasShift = false
  let keyToken: string | null = null

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (
      lower === 'commandorcontrol' ||
      lower === 'cmdorctrl' ||
      lower === 'control' ||
      lower === 'ctrl' ||
      lower === 'command' ||
      lower === 'cmd' ||
      lower === 'meta'
    ) {
      hasCmdOrCtrl = true
    } else if (lower === 'alt' || lower === 'option') {
      hasAlt = true
    } else if (lower === 'shift') {
      hasShift = true
    } else {
      keyToken = normalizeKeyToken(part)
    }
  }

  if (!keyToken) return fallback
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(keyToken)
  if (!hasCmdOrCtrl && !hasAlt && !isFunctionKey) {
    return fallback
  }

  const normalized: string[] = []
  if (hasCmdOrCtrl) normalized.push('CommandOrControl')
  if (hasAlt) normalized.push('Alt')
  if (hasShift) normalized.push('Shift')
  normalized.push(keyToken)
  return normalized.join('+')
}

export function normalizeShortcutBindings(
  partial?: Partial<ShortcutBindings>
): ShortcutBindings {
  return {
    paletteMenu: sanitizeShortcutAccelerator(
      partial?.paletteMenu,
      DEFAULT_SHORTCUT_BINDINGS.paletteMenu
    ),
    openSettings: sanitizeShortcutAccelerator(
      partial?.openSettings,
      DEFAULT_SHORTCUT_BINDINGS.openSettings
    ),
    teleportLogin: sanitizeShortcutAccelerator(
      partial?.teleportLogin,
      DEFAULT_SHORTCUT_BINDINGS.teleportLogin
    ),
    reconnectCluster: sanitizeShortcutAccelerator(
      partial?.reconnectCluster,
      DEFAULT_SHORTCUT_BINDINGS.reconnectCluster
    )
  }
}

export function acceleratorFromKeyboardEvent(event: {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  let candidateKey = event.key
  if (event.code) {
    if (/^Key([A-Z])$/.test(event.code)) {
      candidateKey = event.code.slice(3)
    } else if (/^Digit([0-9])$/.test(event.code)) {
      candidateKey = event.code.slice(5)
    } else if (event.code === 'Comma') {
      candidateKey = ','
    } else if (event.code === 'Period') {
      candidateKey = '.'
    } else if (event.code === 'Slash') {
      candidateKey = '/'
    } else if (event.code === 'Space') {
      candidateKey = 'Space'
    }
  }

  const keyToken = normalizeKeyToken(candidateKey)
  if (!keyToken) return null

  const hasCmdOrCtrl = event.ctrlKey || event.metaKey
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(keyToken)
  if (!hasCmdOrCtrl && !event.altKey && !isFunctionKey) {
    return null
  }

  const parts: string[] = []
  if (hasCmdOrCtrl) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(keyToken)
  return parts.join('+')
}

export interface ElectronInputLike {
  type: string
  key: string
  code?: string
  control?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
  isAutoRepeat?: boolean
}

export function matchesElectronInput(
  input: ElectronInputLike,
  accelerator: string,
  platform: string = typeof process !== 'undefined' ? process.platform : 'win32'
): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false
  if (!accelerator) return false

  const parts = accelerator.split('+').map((p) => p.trim())
  const needCmdOrCtrl = parts.includes('CommandOrControl')
  const needAlt = parts.includes('Alt')
  const needShift = parts.includes('Shift')
  const targetKey = parts[parts.length - 1]
  if (!targetKey) return false

  const primaryModPressed = platform === 'darwin' ? Boolean(input.meta) : Boolean(input.control)
  const extraPrimaryMod = platform === 'darwin' ? Boolean(input.control) : Boolean(input.meta)
  if (extraPrimaryMod) return false

  if (needCmdOrCtrl !== primaryModPressed) return false
  if (needAlt !== Boolean(input.alt)) return false
  if (needShift !== Boolean(input.shift)) return false

  const actualFromEvent = acceleratorFromKeyboardEvent({
    key: input.key,
    code: input.code,
    ctrlKey: Boolean(input.control),
    metaKey: Boolean(input.meta),
    altKey: Boolean(input.alt),
    shiftKey: Boolean(input.shift)
  })
  if (actualFromEvent) {
    const actualParts = actualFromEvent.split('+')
    return actualParts[actualParts.length - 1] === targetKey
  }

  return normalizeKeyToken(input.key) === targetKey
}

/**
 * Matches `Alt+1` .. `Alt+5` quick-slot triggers (returns 0-based slot index or `null`).
 */
export function matchPaletteSlotInput(input: ElectronInputLike): number | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null
  if (!input.alt || input.control || input.meta || input.shift) return null

  let digit: number | null = null
  if (input.code && /^Digit([1-9])$/.test(input.code)) {
    digit = Number(input.code.slice(5))
  } else if (/^[1-9]$/.test(input.key)) {
    digit = Number(input.key)
  }

  if (digit !== null && digit >= 1 && digit <= PALETTE_SLOT_COUNT) {
    return digit - 1
  }
  return null
}

export function formatShortcutKeycaps(
  accelerator: string,
  isMac: boolean = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
): string[] {
  if (!accelerator) return []
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean)

  return parts.map((part) => {
    switch (part) {
      case 'CommandOrControl':
        return isMac ? '⌘' : 'Strg'
      case 'Alt':
        return isMac ? '⌥' : 'Alt'
      case 'Shift':
        return isMac ? '⇧' : 'Umschalt'
      case 'Space':
        return 'Leertaste'
      default:
        return part
    }
  })
}

export function getRadarShortcutConflictWarning(accelerator: string): string | null {
  return RADAR_RESERVED_SHORTCUTS[accelerator] ?? null
}
