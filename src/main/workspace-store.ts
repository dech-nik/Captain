import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deriveClusterDisplayName, normalizeRadarRoutePath, parseRadarRoute } from '@shared/radar-route'
import type {
  ContextSummary,
  PalettePreferencesPatch,
  WorkspaceOrganizerState,
  WorkspacePalette,
  WorkspaceViewRef
} from '@shared/types'

export const MIN_PALETTE_SLOTS = 3
export const MAX_PALETTE_SLOTS = 7
export const DEFAULT_PALETTE_SLOTS = 5

const WORKSPACE_STORE_FILE = 'captain-workspaces.json'
const STORE_SCHEMA_VERSION = 1

interface PersistedWorkspaceData {
  version: number
  favoriteContexts: string[]
  palettes: WorkspacePalette[]
  activePaletteId: string
  slotCount: number
  removeOnDragOutside: boolean
}

export function clampSlotCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PALETTE_SLOTS
  }
  return Math.max(MIN_PALETTE_SLOTS, Math.min(MAX_PALETTE_SLOTS, Math.round(value)))
}

export function resizePaletteSlots(
  slots: Array<WorkspaceViewRef | null>,
  targetCount: number
): Array<WorkspaceViewRef | null> {
  const count = clampSlotCount(targetCount)
  if (slots.length === count) {
    return [...slots]
  }
  if (slots.length < count) {
    return [...slots, ...Array<WorkspaceViewRef | null>(count - slots.length).fill(null)]
  }

  // Shrinking: keep exact positions for indices < count, and rescue any occupied overflow views
  // into rightmost empty slots so reducing slot count does not drop saved views unnecessarily.
  const kept = slots.slice(0, count)
  const overflow = slots.slice(count).filter((v): v is WorkspaceViewRef => v !== null)

  for (const extraView of overflow) {
    let placed = false
    for (let i = count - 1; i >= 0; i--) {
      if (kept[i] === null) {
        kept[i] = extraView
        placed = true
        break
      }
    }
    if (!placed) break
  }

  return kept
}

function sanitizeViewRef(raw: unknown): WorkspaceViewRef | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<WorkspaceViewRef>
  if (!candidate.context || typeof candidate.context !== 'string') return null

  const routePath = normalizeRadarRoutePath(
    typeof candidate.routePath === 'string' ? candidate.routePath : '/'
  )
  const parsed = parseRadarRoute(routePath)

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : randomUUID(),
    context: candidate.context,
    clusterLabel:
      typeof candidate.clusterLabel === 'string' && candidate.clusterLabel.trim()
        ? candidate.clusterLabel.trim()
        : candidate.context,
    isTeleport: Boolean(candidate.isTeleport),
    routePath,
    category: candidate.category || parsed.category,
    kindShort:
      typeof candidate.kindShort === 'string' && candidate.kindShort
        ? candidate.kindShort
        : parsed.kindShort,
    kindName:
      typeof candidate.kindName === 'string' && candidate.kindName
        ? candidate.kindName
        : parsed.kindName,
    targetName:
      typeof candidate.targetName === 'string' && candidate.targetName.trim()
        ? candidate.targetName.trim()
        : parsed.targetName,
    namespaces: Array.isArray(candidate.namespaces)
      ? candidate.namespaces.filter((ns): ns is string => typeof ns === 'string' && ns.trim() !== '')
      : parsed.namespaces,
    customTitle:
      typeof candidate.customTitle === 'string' && candidate.customTitle.trim()
        ? candidate.customTitle.trim()
        : undefined,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now()
  }
}

function createDefaultPalette(slotCount: number, name = 'Hauptpalette'): WorkspacePalette {
  const now = Date.now()
  return {
    id: randomUUID(),
    name,
    locked: false,
    slots: Array<WorkspaceViewRef | null>(clampSlotCount(slotCount)).fill(null),
    createdAt: now,
    updatedAt: now
  }
}

function sanitizePalette(raw: unknown, slotCount: number): WorkspacePalette | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Partial<WorkspacePalette>
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Palette'
  const rawSlots = Array.isArray(obj.slots) ? obj.slots.map(sanitizeViewRef) : []
  const now = Date.now()

  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : randomUUID(),
    name,
    locked: Boolean(obj.locked),
    slots: resizePaletteSlots(rawSlots, slotCount),
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now
  }
}

/**
 * Crash-safe, atomic store for Captain's Cluster Favorites and Horizontal View Palettes.
 * Uses write-then-rename semantics so interrupted writes never corrupt saved workspaces.
 */
export class WorkspaceStore {
  private userDataDir: string | null = null
  private data: PersistedWorkspaceData

  constructor() {
    const initialPalette = createDefaultPalette(DEFAULT_PALETTE_SLOTS)
    this.data = {
      version: STORE_SCHEMA_VERSION,
      favoriteContexts: [],
      palettes: [initialPalette],
      activePaletteId: initialPalette.id,
      slotCount: DEFAULT_PALETTE_SLOTS,
      removeOnDragOutside: true
    }
  }

  public load(userDataDir: string): void {
    this.userDataDir = userDataDir
    const filePath = join(userDataDir, WORKSPACE_STORE_FILE)
    if (!existsSync(filePath)) {
      this.persist()
      return
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<PersistedWorkspaceData>
      const slotCount = clampSlotCount(parsed.slotCount)
      const favoriteContexts = Array.isArray(parsed.favoriteContexts)
        ? Array.from(
            new Set(
              parsed.favoriteContexts.filter(
                (item): item is string => typeof item === 'string' && item.trim() !== ''
              )
            )
          )
        : []

      const palettes = Array.isArray(parsed.palettes)
        ? parsed.palettes
            .map((p) => sanitizePalette(p, slotCount))
            .filter((p): p is WorkspacePalette => p !== null)
        : []

      if (palettes.length === 0) {
        palettes.push(createDefaultPalette(slotCount))
      }

      const activeExists = palettes.some((p) => p.id === parsed.activePaletteId)
      this.data = {
        version: STORE_SCHEMA_VERSION,
        favoriteContexts,
        palettes,
        activePaletteId: activeExists && parsed.activePaletteId ? parsed.activePaletteId : palettes[0].id,
        slotCount,
        removeOnDragOutside: parsed.removeOnDragOutside ?? true
      }
    } catch {
      // Keep clean default state if file was unreadable
    }
  }

  private persist(): void {
    if (!this.userDataDir) return
    const targetFile = join(this.userDataDir, WORKSPACE_STORE_FILE)
    const tempFile = `${targetFile}.${process.pid}.${Date.now()}.tmp`
    mkdirSync(dirname(targetFile), { recursive: true })
    try {
      writeFileSync(tempFile, JSON.stringify(this.data, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
      renameSync(tempFile, targetFile)
    } catch {
      try {
        if (existsSync(tempFile)) unlinkSync(tempFile)
      } catch {
        // ignore cleanup failure
      }
      // Fallback direct write on filesystems that disallow rename over open handle
      writeFileSync(targetFile, JSON.stringify(this.data, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
    }
  }

  public getSnapshot(
    overlayMode: WorkspaceOrganizerState['overlayMode'],
    liveView: WorkspaceViewRef | null
  ): WorkspaceOrganizerState {
    return {
      overlayMode,
      favoriteContexts: [...this.data.favoriteContexts],
      palettes: this.data.palettes.map((p) => ({
        ...p,
        slots: p.slots.map((slot) => (slot ? { ...slot, namespaces: [...slot.namespaces] } : null))
      })),
      activePaletteId: this.data.activePaletteId,
      slotCount: this.data.slotCount,
      removeOnDragOutside: this.data.removeOnDragOutside,
      liveView: liveView ? { ...liveView, namespaces: [...liveView.namespaces] } : null
    }
  }

  public getSlotCount(): number {
    return this.data.slotCount
  }

  public getActivePalette(): WorkspacePalette {
    return (
      this.data.palettes.find((p) => p.id === this.data.activePaletteId) || this.data.palettes[0]
    )
  }

  public toggleFavoriteContext(contextName: string): boolean {
    const clean = contextName.trim()
    if (!clean) return false
    const idx = this.data.favoriteContexts.indexOf(clean)
    let nowFavorite = false
    if (idx >= 0) {
      this.data.favoriteContexts.splice(idx, 1)
    } else {
      this.data.favoriteContexts.push(clean)
      nowFavorite = true
    }
    this.persist()
    return nowFavorite
  }

  public setActivePalette(paletteId: string): boolean {
    if (!this.data.palettes.some((p) => p.id === paletteId)) return false
    this.data.activePaletteId = paletteId
    this.persist()
    return true
  }

  public createPalette(name?: string): WorkspacePalette {
    const cleanName =
      name && name.trim() ? name.trim() : `Palette ${this.data.palettes.length + 1}`
    const created = createDefaultPalette(this.data.slotCount, cleanName)
    this.data.palettes.push(created)
    this.data.activePaletteId = created.id
    this.persist()
    return created
  }

  public renamePalette(paletteId: string, name: string): boolean {
    const clean = name.trim()
    if (!clean) return false
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette) return false
    palette.name = clean.slice(0, 48)
    palette.updatedAt = Date.now()
    this.persist()
    return true
  }

  public setPaletteLocked(paletteId: string, locked: boolean): boolean {
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette) return false
    palette.locked = locked
    palette.updatedAt = Date.now()
    this.persist()
    return true
  }

  public clearPaletteSlots(paletteId: string): boolean {
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette || palette.locked) return false
    palette.slots = Array<WorkspaceViewRef | null>(this.data.slotCount).fill(null)
    palette.updatedAt = Date.now()
    this.persist()
    return true
  }

  public deletePalette(paletteId: string): boolean {
    const idx = this.data.palettes.findIndex((p) => p.id === paletteId)
    if (idx === -1) return false
    if (this.data.palettes[idx].locked) return false

    this.data.palettes.splice(idx, 1)
    if (this.data.palettes.length === 0) {
      const fresh = createDefaultPalette(this.data.slotCount)
      this.data.palettes.push(fresh)
      this.data.activePaletteId = fresh.id
    } else if (this.data.activePaletteId === paletteId) {
      const nextIdx = Math.min(idx, this.data.palettes.length - 1)
      this.data.activePaletteId = this.data.palettes[nextIdx].id
    }
    this.persist()
    return true
  }

  public assignViewToSlot(
    paletteId: string,
    slotIndex: number,
    view: WorkspaceViewRef
  ): boolean {
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette || palette.locked) return false
    if (slotIndex < 0 || slotIndex >= this.data.slotCount) return false

    const sanitized = sanitizeViewRef({
      ...view,
      id: randomUUID(),
      createdAt: Date.now()
    })
    if (!sanitized) return false

    palette.slots[slotIndex] = sanitized
    palette.updatedAt = Date.now()
    this.persist()
    return true
  }

  public moveOrSwapSlot(paletteId: string, fromIndex: number, toIndex: number): boolean {
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette || palette.locked) return false
    if (
      fromIndex < 0 ||
      fromIndex >= this.data.slotCount ||
      toIndex < 0 ||
      toIndex >= this.data.slotCount ||
      fromIndex === toIndex
    ) {
      return false
    }
    if (!palette.slots[fromIndex]) return false

    const temp = palette.slots[toIndex]
    palette.slots[toIndex] = palette.slots[fromIndex]
    palette.slots[fromIndex] = temp
    palette.updatedAt = Date.now()
    this.persist()
    return true
  }

  public removeSlotView(paletteId: string, slotIndex: number): WorkspaceViewRef | null {
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette || palette.locked) return null
    if (slotIndex < 0 || slotIndex >= this.data.slotCount) return null

    const existing = palette.slots[slotIndex]
    if (!existing) return null

    palette.slots[slotIndex] = null
    palette.updatedAt = Date.now()
    this.persist()
    return existing
  }

  public renameSlotView(paletteId: string, slotIndex: number, customTitle: string): boolean {
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette || palette.locked) return false
    const slot = palette.slots[slotIndex]
    if (!slot) return false

    const trimmed = customTitle.trim()
    slot.customTitle = trimmed ? trimmed.slice(0, 48) : undefined
    palette.updatedAt = Date.now()
    this.persist()
    return true
  }

  public updatePreferences(patch: PalettePreferencesPatch): void {
    let changed = false
    if (patch.slotCount !== undefined) {
      const nextCount = clampSlotCount(patch.slotCount)
      if (nextCount !== this.data.slotCount) {
        this.data.slotCount = nextCount
        for (const palette of this.data.palettes) {
          palette.slots = resizePaletteSlots(palette.slots, nextCount)
        }
        changed = true
      }
    }
    if (
      typeof patch.removeOnDragOutside === 'boolean' &&
      patch.removeOnDragOutside !== this.data.removeOnDragOutside
    ) {
      this.data.removeOnDragOutside = patch.removeOnDragOutside
      changed = true
    }
    if (changed) {
      this.persist()
    }
  }

  public syncContextDisplayMetadata(contexts: ContextSummary[]): void {
    if (contexts.length === 0) return
    let mutated = false
    for (const palette of this.data.palettes) {
      for (const slot of palette.slots) {
        if (!slot) continue
        const found = contexts.find((c) => c.name === slot.context)
        if (!found) continue
        const derived = deriveClusterDisplayName(slot.context, contexts)
        if (
          slot.clusterLabel !== derived.clusterLabel ||
          slot.isTeleport !== derived.isTeleport
        ) {
          slot.clusterLabel = derived.clusterLabel
          slot.isTeleport = derived.isTeleport
          mutated = true
        }
      }
    }
    if (mutated) {
      this.persist()
    }
  }
}
