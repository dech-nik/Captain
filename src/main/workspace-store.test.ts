import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceViewRef } from '@shared/types'
import { WorkspaceStore } from './workspace-store'

function makeSampleView(
  context: string,
  routePath: string,
  kindShort: string,
  kindName: string
): WorkspaceViewRef {
  return {
    id: `id-${context}-${kindShort}`,
    context,
    clusterLabel: context,
    isTeleport: true,
    routePath,
    category: 'workloads',
    kindShort,
    kindName,
    namespaces: ['payments'],
    createdAt: 1700000000000
  }
}

describe('WorkspaceStore persistence, locking, and horizontal slot management', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'captain-ws-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('persists favorites and horizontal palette slots atomically across reloads', () => {
    const store = new WorkspaceStore()
    store.load(tempDir)

    expect(store.getSlotCount()).toBe(5)
    expect(store.toggleFavoriteContext('prod-eu')).toBe(true)
    expect(store.toggleFavoriteContext('staging-eu')).toBe(true)

    const paletteId = store.getActivePalette().id
    const v1 = makeSampleView('prod-eu', '/resources/deployments?namespaces=payments', 'deploy', 'Deployments')
    const v4 = makeSampleView('staging-eu', '/topology?namespaces=payments', 'topo', 'Topologie')

    // Place views in Slot 0 and Slot 3, keeping Slots 1, 2, 4 empty
    expect(store.assignViewToSlot(paletteId, 0, v1)).toBe(true)
    expect(store.assignViewToSlot(paletteId, 3, v4)).toBe(true)

    // Reload from disk in a fresh instance
    const reloaded = new WorkspaceStore()
    reloaded.load(tempDir)
    const snap = reloaded.getSnapshot('palette', null)

    expect(snap.favoriteContexts).toEqual(['prod-eu', 'staging-eu'])
    expect(snap.palettes[0].slots[0]?.kindShort).toBe('deploy')
    expect(snap.palettes[0].slots[1]).toBeNull()
    expect(snap.palettes[0].slots[2]).toBeNull()
    expect(snap.palettes[0].slots[3]?.kindShort).toBe('topo')
    expect(snap.palettes[0].slots[4]).toBeNull()
  })

  it('swaps and moves horizontal slots and removes views cleanly', () => {
    const store = new WorkspaceStore()
    store.load(tempDir)
    const pid = store.getActivePalette().id

    store.assignViewToSlot(pid, 0, makeSampleView('prod-eu', '/resources/pods', 'po', 'Pods'))
    store.assignViewToSlot(pid, 2, makeSampleView('prod-eu', '/helm', 'helm', 'Helm Releases'))

    // Swap Slot 0 and Slot 2
    expect(store.moveOrSwapSlot(pid, 0, 2)).toBe(true)
    expect(store.getActivePalette().slots[0]?.kindShort).toBe('helm')
    expect(store.getActivePalette().slots[2]?.kindShort).toBe('po')

    // Move Slot 2 to empty Slot 4
    expect(store.moveOrSwapSlot(pid, 2, 4)).toBe(true)
    expect(store.getActivePalette().slots[2]).toBeNull()
    expect(store.getActivePalette().slots[4]?.kindShort).toBe('po')

    // Remove Slot 4 (trash or drag-outside pop)
    const popped = store.removeSlotView(pid, 4)
    expect(popped?.kindShort).toBe('po')
    expect(store.getActivePalette().slots[4]).toBeNull()
  })

  it('strictly enforces palette lock against accidental edits or deletion', () => {
    const store = new WorkspaceStore()
    store.load(tempDir)
    const pid = store.getActivePalette().id

    store.assignViewToSlot(pid, 1, makeSampleView('prod-eu', '/issues', 'issues', 'Probleme'))
    store.setPaletteLocked(pid, true)

    // Attempt overwrite, move, remove, clear, and delete while locked
    expect(
      store.assignViewToSlot(pid, 1, makeSampleView('prod-eu', '/helm', 'helm', 'Helm'))
    ).toBe(false)
    expect(store.moveOrSwapSlot(pid, 1, 3)).toBe(false)
    expect(store.removeSlotView(pid, 1)).toBeNull()
    expect(store.clearPaletteSlots(pid)).toBe(false)
    expect(store.deletePalette(pid)).toBe(false)

    // Original view remains intact in Slot 1
    expect(store.getActivePalette().slots[1]?.kindShort).toBe('issues')

    // Unlocking restores mutability
    store.setPaletteLocked(pid, false)
    expect(store.removeSlotView(pid, 1)?.kindShort).toBe('issues')
  })

  it('rescues occupied views in rightmost slots when reducing slotCount', () => {
    const store = new WorkspaceStore()
    store.load(tempDir)
    const pid = store.getActivePalette().id

    store.assignViewToSlot(pid, 0, makeSampleView('c1', '/topology', 'topo', 'Topologie'))
    store.assignViewToSlot(pid, 4, makeSampleView('c2', '/helm', 'helm', 'Helm'))

    // Shrink from 5 slots to 3 slots -> Slot 4 ('helm') should be rescued into empty Slot 2!
    store.updatePreferences({ slotCount: 3 })
    const slots = store.getActivePalette().slots
    expect(slots).toHaveLength(3)
    expect(slots[0]?.kindShort).toBe('topo')
    expect(slots[2]?.kindShort).toBe('helm')
  })
})
