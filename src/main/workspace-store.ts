import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deriveClusterDisplayName, normalizeRadarRoutePath, parseRadarRoute } from '@shared/radar-route'
import {
  PALETTE_SLOT_COUNT,
  type ContextSummary,
  type WorkspaceOrganizerState,
  type WorkspacePalette,
  type WorkspaceViewRef
} from '@shared/types'

const WORKSPACE_STORE_FILE = 'captain-workspaces.json'
const STORE_SCHEMA_VERSION = 2

interface PersistedWorkspaceData {
  version: number
  palettes: WorkspacePalette[]
  activePaletteId: string
}

export function normalizePaletteSlots(
  slots: Array<WorkspaceViewRef | null>
): Array<WorkspaceViewRef | null> {
  if (slots.length === PALETTE_SLOT_COUNT) {
    return [...slots]
  }
  if (slots.length < PALETTE_SLOT_COUNT) {
    return [
      ...slots,
      ...Array<WorkspaceViewRef | null>(PALETTE_SLOT_COUNT - slots.length).fill(null)
    ]
  }

  const kept = slots.slice(0, PALETTE_SLOT_COUNT)
  const overflow = slots
    .slice(PALETTE_SLOT_COUNT)
    .filter((v): v is WorkspaceViewRef => v !== null)

  for (const extraView of overflow) {
    for (let i = PALETTE_SLOT_COUNT - 1; i >= 0; i--) {
      if (kept[i] === null) {
        kept[i] = extraView
        break
      }
    }
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
    kindName:
      typeof candidate.kindName === 'string' && candidate.kindName.trim()
        ? candidate.kindName.trim()
        : parsed.kindName,
    targetName:
      typeof candidate.targetName === 'string' && candidate.targetName.trim()
        ? candidate.targetName.trim()
        : parsed.targetName,
    namespaces: Array.isArray(candidate.namespaces)
      ? candidate.namespaces.filter(
          (ns): ns is string => typeof ns === 'string' && ns.trim() !== ''
        )
      : parsed.namespaces,
    isClusterScoped:
      typeof candidate.isClusterScoped === 'boolean'
        ? candidate.isClusterScoped
        : parsed.isClusterScoped,
    customTitle:
      typeof candidate.customTitle === 'string' && candidate.customTitle.trim()
        ? candidate.customTitle.trim()
        : undefined,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now()
  }
}

function createDefaultPalette(name = 'Hauptpalette'): WorkspacePalette {
  const now = Date.now()
  return {
    id: randomUUID(),
    name,
    locked: false,
    slots: Array<WorkspaceViewRef | null>(PALETTE_SLOT_COUNT).fill(null),
    createdAt: now,
    updatedAt: now
  }
}

function sanitizePalette(raw: unknown): WorkspacePalette | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Partial<WorkspacePalette>
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Palette'
  const rawSlots = Array.isArray(obj.slots) ? obj.slots.map(sanitizeViewRef) : []
  const now = Date.now()

  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : randomUUID(),
    name,
    locked: Boolean(obj.locked),
    slots: normalizePaletteSlots(rawSlots),
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now
  }
}

/**
 * Crash-safe, atomic store for Captain's 5-slot Horizontal View Palettes.
 */
export class WorkspaceStore {
  private userDataDir: string | null = null
  private data: PersistedWorkspaceData

  constructor() {
    const initialPalette = createDefaultPalette()
    this.data = {
      version: STORE_SCHEMA_VERSION,
      palettes: [initialPalette],
      activePaletteId: initialPalette.id
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
      const palettes = Array.isArray(parsed.palettes)
        ? parsed.palettes
            .map(sanitizePalette)
            .filter((p): p is WorkspacePalette => p !== null)
        : []

      if (palettes.length === 0) {
        palettes.push(createDefaultPalette())
      }

      const activeExists = palettes.some((p) => p.id === parsed.activePaletteId)
      this.data = {
        version: STORE_SCHEMA_VERSION,
        palettes,
        activePaletteId:
          activeExists && parsed.activePaletteId ? parsed.activePaletteId : palettes[0].id
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
      palettes: this.data.palettes.map((p) => ({
        ...p,
        slots: p.slots.map((slot) => (slot ? { ...slot, namespaces: [...slot.namespaces] } : null))
      })),
      activePaletteId: this.data.activePaletteId,
      liveView: liveView ? { ...liveView, namespaces: [...liveView.namespaces] } : null
    }
  }

  public getActivePalette(): WorkspacePalette {
    return (
      this.data.palettes.find((p) => p.id === this.data.activePaletteId) || this.data.palettes[0]
    )
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
    const created = createDefaultPalette(cleanName)
    this.data.palettes.push(created)
    this.data.activePaletteId = created.id
    this.persist()
    return created
  }

  public renamePalette(paletteId: string, name: string): boolean {
    const clean = name.trim()
    if (!clean) return false
    const palette = this.data.palettes.find((p) => p.id === paletteId)
    if (!palette || palette.locked) return false
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
    palette.slots = Array<WorkspaceViewRef | null>(PALETTE_SLOT_COUNT).fill(null)
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
      const fresh = createDefaultPalette()
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
    if (slotIndex < 0 || slotIndex >= PALETTE_SLOT_COUNT) return false

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
      fromIndex >= PALETTE_SLOT_COUNT ||
      toIndex < 0 ||
      toIndex >= PALETTE_SLOT_COUNT ||
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
    if (slotIndex < 0 || slotIndex >= PALETTE_SLOT_COUNT) return null

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
