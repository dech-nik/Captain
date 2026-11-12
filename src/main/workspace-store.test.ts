import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PALETTE_SLOT_COUNT, type WorkspaceViewRef } from '@shared/types'
import { WorkspaceStore } from './workspace-store'

function makeSampleView(
  context: string,
  routePath: string,
  kindName: string,
  targetName?: string
): WorkspaceViewRef {
  return {
    id: `id-${context}-${kindName}`,
    context,
    clusterLabel: context,
    isTeleport: true,
    routePath,
    category: 'workloads',
    kindName,
    targetName,
    namespaces: ['payments'],
    createdAt: 1700000000000
  }
}

describe('WorkspaceStore 5-slot palette persistence and locking', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'captain-ws-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('always maintains 5 horizontal slots and persists views atomically across reloads', () => {
    const store = new WorkspaceStore()
    store.load(tempDir)

    const palette = store.getActivePalette()
    expect(palette.slots).toHaveLength(PALETTE_SLOT_COUNT)

    const v1 = makeSampleView(
      'prod-eu',
      '/workload/deployments/payments/checkout-api',
      'Deployment',
      'checkout-api'
    )
    const v4 = makeSampleView('staging-eu', '/topology?namespaces=payments', 'Topologie')

    expect(store.assignViewToSlot(palette.id, 0, v1)).toBe(true)
    expect(store.assignViewToSlot(palette.id, 3, v4)).toBe(true)

    const reloaded = new WorkspaceStore()
    reloaded.load(tempDir)
    const snap = reloaded.getSnapshot('palette', null)

    expect(snap.palettes[0].slots).toHaveLength(5)
    expect(snap.palettes[0].slots[0]?.targetName).toBe('checkout-api')
    expect(snap.palettes[0].slots[1]).toBeNull()
    expect(snap.palettes[0].slots[2]).toBeNull()
    expect(snap.palettes[0].slots[3]?.kindName).toBe('Topologie')
    expect(snap.palettes[0].slots[4]).toBeNull()
  })

  it('swaps and moves horizontal slots and removes views cleanly', () => {
    const store = new WorkspaceStore()
    store.load(tempDir)
    const pid = store.getActivePalette().id

    store.assignViewToSlot(pid, 0, makeSampleView('prod-eu', '/resources/pods', 'Pods'))
    store.assignViewToSlot(pid, 2, makeSampleView('prod-eu', '/helm', 'Helm Releases'))

    expect(store.moveOrSwapSlot(pid, 0, 2)).toBe(true)
    expect(store.getActivePalette().slots[0]?.kindName).toBe('Helm Releases')
    expect(store.getActivePalette().slots[2]?.kindName).toBe('Pods')

    expect(store.moveOrSwapSlot(pid, 2, 4)).toBe(true)
    expect(store.getActivePalette().slots[2]).toBeNull()
    expect(store.getActivePalette().slots[4]?.kindName).toBe('Pods')

    const popped = store.removeSlotView(pid, 4)
    expect(popped?.kindName).toBe('Pods')
    expect(store.getActivePalette().slots[4]).toBeNull()
  })

  it('enforces palette lock against overwrite, move, rename, clear, and delete', () => {
    const store = new WorkspaceStore()
    store.load(tempDir)
    const pid = store.getActivePalette().id

    store.assignViewToSlot(pid, 1, makeSampleView('prod-eu', '/issues', 'Probleme'))
    store.setPaletteLocked(pid, true)

    expect(store.assignViewToSlot(pid, 1, makeSampleView('prod-eu', '/helm', 'Helm'))).toBe(
      false
    )
    expect(store.moveOrSwapSlot(pid, 1, 3)).toBe(false)
    expect(store.renamePalette(pid, 'Geändert')).toBe(false)
    expect(store.removeSlotView(pid, 1)).toBeNull()
    expect(store.clearPaletteSlots(pid)).toBe(false)
    expect(store.deletePalette(pid)).toBe(false)

    expect(store.getActivePalette().slots[1]?.kindName).toBe('Probleme')

    store.setPaletteLocked(pid, false)
    expect(store.removeSlotView(pid, 1)?.kindName).toBe('Probleme')
  })

  it('normalizes legacy variable-length slot arrays on load to exactly 5 slots', () => {
    writeFileSync(
      join(tempDir, 'captain-workspaces.json'),
      JSON.stringify({
        version: 1,
        activePaletteId: 'legacy-1',
        palettes: [
          {
            id: 'legacy-1',
            name: 'Legacy',
            locked: false,
            slots: [
              makeSampleView('c1', '/topology', 'Topologie'),
              null,
              null,
              null,
              null,
              null,
              makeSampleView('c2', '/helm', 'Helm Releases')
            ]
          }
        ]
      }),
      'utf8'
    )

    const store = new WorkspaceStore()
    store.load(tempDir)
    const slots = store.getActivePalette().slots
    expect(slots).toHaveLength(5)
    expect(slots[0]?.kindName).toBe('Topologie')
    expect(slots[4]?.kindName).toBe('Helm Releases')
  })
})
