import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  deriveClusterDisplayName,
  getViewPrimaryLabel,
  isSameWorkspaceDestination
} from '@shared/radar-route'
import { formatShortcutKeycaps } from '@shared/shortcuts'
import type {
  CaptainPreferences,
  ContextSummary,
  WorkspaceOrganizerState,
  WorkspacePalette,
  WorkspaceViewRef
} from '@shared/types'
import { CaptainIcon } from './BrandMark'
import {
  ClusterHelmIcon,
  DragGripIcon,
  LockIcon,
  NamespaceCubeIcon,
  ResourceCliBadge,
  StarIcon,
  TrashBinIcon
} from './K8sIcons'

interface WorkspaceOverlayProps {
  contexts: ContextSummary[]
  currentContext: string
  workspace: WorkspaceOrganizerState
  preferences: CaptainPreferences
}

type DragSource =
  | { kind: 'live'; view: WorkspaceViewRef }
  | { kind: 'slot'; paletteId: string; slotIndex: number; view: WorkspaceViewRef }

type DropZone =
  | { kind: 'slot'; slotIndex: number }
  | { kind: 'trash' }
  | { kind: 'outside' }
  | null

interface ActivePointerDrag {
  source: DragSource
  startX: number
  startY: number
  currentX: number
  currentY: number
  dragging: boolean
  hoveredZone: DropZone
}

interface QuickSwitcherItem {
  type: 'context' | 'saved_view'
  key: string
  context?: ContextSummary
  isFavorite?: boolean
  savedView?: WorkspaceViewRef
  paletteName?: string
}

function formatNamespaceSummary(namespaces: string[]): { text: string; scoped: boolean } {
  if (!namespaces || namespaces.length === 0) {
    return { text: 'alle-ns', scoped: false }
  }
  if (namespaces.length === 1) {
    return { text: namespaces[0], scoped: true }
  }
  return { text: `${namespaces[0]} +${namespaces.length - 1}`, scoped: true }
}

function resolveDropZoneAtPoint(
  clientX: number,
  clientY: number,
  source: DragSource
): DropZone {
  const elements = document.elementsFromPoint(clientX, clientY)
  for (const el of elements) {
    const htmlEl = el as HTMLElement
    const zoneAttr = htmlEl.dataset?.dropZone
    if (zoneAttr === 'slot') {
      const idx = Number(htmlEl.dataset.slotIndex)
      if (Number.isInteger(idx) && idx >= 0) {
        return { kind: 'slot', slotIndex: idx }
      }
    }
    if (zoneAttr === 'trash') {
      if (source.kind === 'slot') {
        return { kind: 'trash' }
      }
      return null
    }
    if (zoneAttr === 'palette-shell' || zoneAttr === 'live-anchor') {
      return null
    }
  }
  // Pointer is outside the palette shell over the live blurred Radar workspace
  if (source.kind === 'slot') {
    return { kind: 'outside' }
  }
  return null
}

const ViewCoordinateBody: React.FC<{
  view: WorkspaceViewRef
  compact?: boolean
}> = ({ view, compact = false }) => {
  const primaryTitle = getViewPrimaryLabel(view)
  const showKindSub =
    Boolean(view.customTitle?.trim()) ||
    (Boolean(view.targetName) && primaryTitle !== view.kindName)
  const nsInfo = formatNamespaceSummary(view.namespaces)

  return (
    <div className={`view-coord-stack ${compact ? 'is-compact' : ''}`}>
      <div className="view-title-group">
        <span className="view-primary-title" title={primaryTitle}>
          {primaryTitle}
        </span>
        {showKindSub && (
          <span className="view-kind-subtitle" title={view.kindName}>
            {view.kindName}
          </span>
        )}
      </div>

      <div className="view-taxonomy-chips">
        <span
          className="k8s-chip k8s-chip-cluster"
          title={`Kubernetes-Cluster: ${view.context}${view.isTeleport ? ' (Teleport)' : ''}`}
        >
          <ClusterHelmIcon size={12} />
          <span className="k8s-chip-text">{view.clusterLabel || view.context}</span>
          {view.isTeleport && <span className="k8s-teleport-dot" title="Teleport-Cluster" />}
        </span>

        <span
          className={`k8s-chip ${nsInfo.scoped ? 'k8s-chip-namespace' : 'k8s-chip-namespace-all'}`}
          title={
            nsInfo.scoped
              ? `Namespace: ${view.namespaces.join(', ')}`
              : 'Clusterweit (alle Namespaces)'
          }
        >
          <NamespaceCubeIcon size={11} />
          <span className="k8s-chip-prefix">ns:</span>
          <span className="k8s-chip-text">{nsInfo.text}</span>
        </span>
      </div>
    </div>
  )
}

export const WorkspaceOverlay: React.FC<WorkspaceOverlayProps> = ({
  contexts,
  currentContext,
  workspace,
  preferences
}) => {
  const mode = workspace.overlayMode
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)

  // --- Quick-Switcher State ---
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const listContainerRef = useRef<HTMLDivElement | null>(null)

  // --- Palette Deck State ---
  const [renamingPaletteId, setRenamingPaletteId] = useState<string | null>(null)
  const [paletteNameDraft, setPaletteNameDraft] = useState('')
  const [renamingSlotIndex, setRenamingSlotIndex] = useState<number | null>(null)
  const [slotTitleDraft, setSlotTitleDraft] = useState('')
  const [lockedNoticePulse, setLockedNoticePulse] = useState(false)
  const [dragState, setDragState] = useState<ActivePointerDrag | null>(null)
  const dragRef = useRef<ActivePointerDrag | null>(null)

  const activePalette: WorkspacePalette | undefined = useMemo(
    () =>
      workspace.palettes.find((p) => p.id === workspace.activePaletteId) ??
      workspace.palettes[0],
    [workspace.palettes, workspace.activePaletteId]
  )

  const favoriteSet = useMemo(
    () => new Set(workspace.favoriteContexts),
    [workspace.favoriteContexts]
  )

  // Build filtered Quick-Switcher items (Favorites first, then remaining contexts, plus matching saved views)
  const quickItems = useMemo<QuickSwitcherItem[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    const matchesCtx = (ctx: ContextSummary): boolean => {
      if (!q) return true
      const hay = [
        ctx.name,
        ctx.cluster,
        ctx.namespace || '',
        ctx.teleport.kubeCluster || '',
        ctx.teleport.teleportCluster || '',
        ctx.teleport.proxyAddr || '',
        ctx.teleport.isTeleport ? 'teleport' : 'lokal kubeconfig'
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    }

    const favs: QuickSwitcherItem[] = []
    const others: QuickSwitcherItem[] = []

    // Preserve user's favorite order for starred contexts
    for (const favName of workspace.favoriteContexts) {
      const ctx = contexts.find((c) => c.name === favName)
      if (ctx && matchesCtx(ctx)) {
        favs.push({
          type: 'context',
          key: `fav:${ctx.name}`,
          context: ctx,
          isFavorite: true
        })
      }
    }

    for (const ctx of contexts) {
      if (favoriteSet.has(ctx.name)) continue
      if (matchesCtx(ctx)) {
        others.push({
          type: 'context',
          key: `ctx:${ctx.name}`,
          context: ctx,
          isFavorite: false
        })
      }
    }

    const viewHits: QuickSwitcherItem[] = []
    if (q) {
      for (const palette of workspace.palettes) {
        for (let i = 0; i < palette.slots.length; i++) {
          const slot = palette.slots[i]
          if (!slot) continue
          const hay = [
            getViewPrimaryLabel(slot),
            slot.kindName,
            slot.kindShort,
            slot.context,
            slot.clusterLabel,
            slot.namespaces.join(' '),
            palette.name
          ]
            .join(' ')
            .toLowerCase()
          if (hay.includes(q)) {
            viewHits.push({
              type: 'saved_view',
              key: `view:${palette.id}:${i}:${slot.id}`,
              savedView: slot,
              paletteName: palette.name
            })
          }
        }
      }
    }

    return [...favs, ...others, ...viewHits]
  }, [contexts, favoriteSet, searchQuery, workspace.favoriteContexts, workspace.palettes])

  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery, mode])

  useEffect(() => {
    if (mode === 'quick_switcher') {
      setSearchQuery('')
      setTimeout(() => searchInputRef.current?.focus(), 20)
    } else {
      setRenamingPaletteId(null)
      setRenamingSlotIndex(null)
    }
  }, [mode])

  // Keyboard handling for Quick-Switcher & Palette Deck
  useEffect(() => {
    if (mode === 'closed') return undefined

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (dragRef.current?.dragging) {
          e.preventDefault()
          dragRef.current = null
          setDragState(null)
          return
        }
        if (renamingPaletteId || renamingSlotIndex !== null) {
          setRenamingPaletteId(null)
          setRenamingSlotIndex(null)
          return
        }
        e.preventDefault()
        void window.launcherApi.setWorkspaceOverlayMode('closed')
        return
      }

      // Allow Tab (when not editing inline text inside palette rename) to flip between Cluster Switcher & Palettes
      if (
        e.key === 'Tab' &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !renamingPaletteId &&
        renamingSlotIndex === null
      ) {
        e.preventDefault()
        const nextMode = mode === 'quick_switcher' ? 'palette' : 'quick_switcher'
        void window.launcherApi.setWorkspaceOverlayMode(nextMode)
        return
      }

      if (mode === 'quick_switcher') {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((prev) =>
            quickItems.length === 0 ? 0 : (prev + 1) % quickItems.length
          )
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((prev) =>
            quickItems.length === 0
              ? 0
              : (prev - 1 + quickItems.length) % quickItems.length
          )
        } else if (e.key === 'Enter') {
          const item = quickItems[selectedIndex]
          if (!item) return
          e.preventDefault()
          if (item.type === 'context' && item.context) {
            void window.launcherApi.switchClusterContext(item.context.name)
          } else if (item.type === 'saved_view' && item.savedView) {
            void window.launcherApi.activateWorkspaceView(item.savedView)
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          const item = quickItems[selectedIndex]
          if (item?.type === 'context' && item.context) {
            e.preventDefault()
            void window.launcherApi.toggleFavoriteContext(item.context.name)
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, quickItems, selectedIndex, renamingPaletteId, renamingSlotIndex])

  // Scroll selected quick-switcher row into view
  useEffect(() => {
    if (mode !== 'quick_switcher' || !listContainerRef.current) return
    const activeRow = listContainerRef.current.querySelector<HTMLElement>(
      `[data-quick-idx="${selectedIndex}"]`
    )
    activeRow?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, mode])

  // Pointer drag lifecycle for Horizontal Palette Deck
  useEffect(() => {
    if (!dragState) return undefined

    const handlePointerMove = (e: PointerEvent): void => {
      const current = dragRef.current
      if (!current) return
      const dx = e.clientX - current.startX
      const dy = e.clientY - current.startY
      const movedEnough = current.dragging || Math.hypot(dx, dy) > 6

      if (!movedEnough) return

      // If palette is locked, abort drag and pulse lock indicator
      if (activePalette?.locked) {
        dragRef.current = null
        setDragState(null)
        setLockedNoticePulse(true)
        setTimeout(() => setLockedNoticePulse(false), 1100)
        return
      }

      const hoveredZone = resolveDropZoneAtPoint(e.clientX, e.clientY, current.source)
      const next: ActivePointerDrag = {
        ...current,
        currentX: e.clientX,
        currentY: e.clientY,
        dragging: true,
        hoveredZone
      }
      dragRef.current = next
      setDragState(next)
    }

    const handlePointerUp = (e: PointerEvent): void => {
      const current = dragRef.current
      dragRef.current = null
      setDragState(null)
      if (!current) return

      // Simple click (< 6px travel): navigate directly if clicking an occupied slot!
      if (!current.dragging) {
        if (current.source.kind === 'slot') {
          void window.launcherApi.activateWorkspaceView(current.source.view)
        }
        return
      }

      if (!activePalette || activePalette.locked) return

      const drop = resolveDropZoneAtPoint(e.clientX, e.clientY, current.source)
      if (!drop) return

      if (drop.kind === 'slot') {
        if (current.source.kind === 'live') {
          void window.launcherApi.pinViewToSlot(
            activePalette.id,
            drop.slotIndex,
            current.source.view
          )
        } else if (current.source.kind === 'slot') {
          if (current.source.slotIndex !== drop.slotIndex) {
            void window.launcherApi.movePaletteSlot(
              activePalette.id,
              current.source.slotIndex,
              drop.slotIndex
            )
          }
        }
      } else if (drop.kind === 'trash' && current.source.kind === 'slot') {
        void window.launcherApi.removePaletteSlot(
          current.source.paletteId,
          current.source.slotIndex
        )
      } else if (drop.kind === 'outside' && current.source.kind === 'slot') {
        void window.launcherApi.activateWorkspaceView(
          current.source.view,
          workspace.removeOnDragOutside
            ? {
                removeFromSlot: {
                  paletteId: current.source.paletteId,
                  slotIndex: current.source.slotIndex
                }
              }
            : undefined
        )
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [Boolean(dragState), activePalette, workspace.removeOnDragOutside])

  if (mode === 'closed') return null

  const beginPointerCandidate = (e: React.PointerEvent, source: DragSource): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button, input, select')) return

    const initial: ActivePointerDrag = {
      source,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      dragging: false,
      hoveredZone: null
    }
    dragRef.current = initial
    setDragState(initial)
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    if (dragRef.current?.dragging) return
    void window.launcherApi.setWorkspaceOverlayMode('closed')
  }

  const handleStartPaletteRename = (): void => {
    if (!activePalette) return
    setRenamingPaletteId(activePalette.id)
    setPaletteNameDraft(activePalette.name)
  }

  const handleCommitPaletteRename = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    if (renamingPaletteId && paletteNameDraft.trim()) {
      await window.launcherApi.renamePalette(renamingPaletteId, paletteNameDraft.trim())
    }
    setRenamingPaletteId(null)
  }

  const handleCommitSlotRename = async (slotIndex: number): Promise<void> => {
    if (activePalette) {
      await window.launcherApi.renamePaletteSlot(activePalette.id, slotIndex, slotTitleDraft)
    }
    setRenamingSlotIndex(null)
  }

  const handleCyclePalette = (delta: number): void => {
    if (workspace.palettes.length <= 1 || !activePalette) return
    const idx = workspace.palettes.findIndex((p) => p.id === activePalette.id)
    const nextIdx = (idx + delta + workspace.palettes.length) % workspace.palettes.length
    void window.launcherApi.selectPalette(workspace.palettes[nextIdx].id)
  }

  const handleQuickPinLiveView = (): void => {
    if (!activePalette || activePalette.locked || !workspace.liveView) return
    const emptyIdx = activePalette.slots.findIndex((s) => s === null)
    if (emptyIdx >= 0) {
      void window.launcherApi.pinViewToSlot(activePalette.id, emptyIdx, workspace.liveView)
    }
  }

  // ============================================================================
  // MODE 1: CLUSTER QUICK-SWITCHER (WITH FAVORITES & INSTANT SEARCH)
  // ============================================================================
  if (mode === 'quick_switcher') {
    const favoriteRows = quickItems.filter(
      (item) => item.type === 'context' && item.isFavorite
    )
    const standardRows = quickItems.filter(
      (item) => item.type === 'context' && !item.isFavorite
    )
    const savedViewRows = quickItems.filter((item) => item.type === 'saved_view')

    const indexOfKey = (key: string): number => quickItems.findIndex((i) => i.key === key)

    const renderContextRow = (item: QuickSwitcherItem): React.ReactNode => {
      const ctx = item.context!
      const idx = indexOfKey(item.key)
      const isSelected = idx === selectedIndex
      const isActive = ctx.name === currentContext
      const clusterMeta = deriveClusterDisplayName(ctx.name, contexts)

      return (
        <div
          key={item.key}
          data-quick-idx={idx}
          className={`qs-row ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-current' : ''}`}
          onMouseEnter={() => setSelectedIndex(idx)}
          onClick={() => void window.launcherApi.switchClusterContext(ctx.name)}
        >
          <div className="qs-row-left">
            <span className="qs-cluster-emblem" title="Kubernetes-Cluster">
              <ClusterHelmIcon size={15} />
            </span>

            <div className="qs-row-copy">
              <div className="qs-row-title-line">
                <span className="qs-context-name">{ctx.name}</span>
                {isActive && <span className="qs-active-pill">Aktiv</span>}
                {ctx.teleport.isTeleport && (
                  <span className="qs-teleport-pill">Teleport</span>
                )}
              </div>
              <div className="qs-row-sub">
                <span>
                  {ctx.teleport.proxyAddr
                    ? ctx.teleport.proxyAddr.replace(/:443$/, '')
                    : clusterMeta.clusterLabel}
                </span>
                {ctx.namespace && (
                  <>
                    <span>·</span>
                    <span className="qs-ns-inline">ns:{ctx.namespace}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="qs-row-actions">
            <button
              type="button"
              className={`qs-star-btn ${item.isFavorite ? 'is-fav' : ''}`}
              title={
                item.isFavorite
                  ? 'Aus Favoriten entfernen (Strg+F)'
                  : 'Als Favorit anheften (Strg+F)'
              }
              onClick={(e) => {
                e.stopPropagation()
                void window.launcherApi.toggleFavoriteContext(ctx.name)
              }}
            >
              <StarIcon filled={Boolean(item.isFavorite)} size={14} />
            </button>
            {isSelected && <span className="qs-enter-hint">↵</span>}
          </div>
        </div>
      )
    }

    return (
      <div className="overlay-backdrop overlay-backdrop-glass" onMouseDown={handleBackdropClick}>
        <div className="quick-switcher-shell" onMouseDown={(e) => e.stopPropagation()}>
          <div className="dialog-accent-bar" />

          {/* Mode Switcher Bar */}
          <div className="qs-topbar">
            <div className="qs-brand-left">
              <CaptainIcon size={20} />
              <div className="workspace-mode-segmented" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={true}
                  className="workspace-mode-btn is-active"
                >
                  <ClusterHelmIcon size={13} />
                  <span>Cluster-Auswahl</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={false}
                  className="workspace-mode-btn"
                  onClick={() => void window.launcherApi.setWorkspaceOverlayMode('palette')}
                >
                  <span>Ansichts-Paletten</span>
                  <span className="mode-count-pill">
                    {activePalette?.slots.filter(Boolean).length ?? 0}/{workspace.slotCount}
                  </span>
                </button>
              </div>
            </div>

            <div className="qs-topbar-right">
              <button
                type="button"
                className="btn-ghost-icon"
                onClick={() => void window.launcherApi.openSettings()}
                title="Einstellungen öffnen"
              >
                <span>Einstellungen</span>
              </button>
              <button
                type="button"
                className="btn-ghost-icon"
                onClick={() => void window.launcherApi.setWorkspaceOverlayMode('closed')}
              >
                <span>Esc</span>
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="qs-search-bar">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="qs-search-icon"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className="qs-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cluster, Kubeconfig-Kontext, Namespace oder gespeicherte Ansicht suchen…"
              spellCheck={false}
            />
            {searchQuery && (
              <button
                type="button"
                className="well-icon-btn"
                onClick={() => setSearchQuery('')}
                title="Suche zurücksetzen"
              >
                ✕
              </button>
            )}
          </div>

          {/* Results List */}
          <div ref={listContainerRef} className="qs-results-scroll">
            {contexts.length === 0 ? (
              <div className="qs-empty-state">
                <p className="qs-empty-title">Keine Kubernetes-Kontexte gefunden</p>
                <p className="qs-empty-desc">
                  In Ihrer aktiven <code>KUBECONFIG</code> sind derzeit noch keine Cluster hinterlegt.
                </p>
              </div>
            ) : quickItems.length === 0 ? (
              <div className="qs-empty-state">
                <p className="qs-empty-title">Keine Treffer für „{searchQuery}“</p>
                <p className="qs-empty-desc">
                  Prüfen Sie den Suchbegriff oder wechseln Sie mit <code>Tab</code> zu den Ansichts-Paletten.
                </p>
              </div>
            ) : (
              <>
                {favoriteRows.length > 0 && (
                  <div className="qs-group">
                    <div className="qs-group-heading">
                      <StarIcon filled={true} size={11} />
                      <span>Favoriten</span>
                    </div>
                    {favoriteRows.map(renderContextRow)}
                  </div>
                )}

                {standardRows.length > 0 && (
                  <div className="qs-group">
                    <div className="qs-group-heading">
                      <ClusterHelmIcon size={11} />
                      <span>
                        {favoriteRows.length > 0
                          ? 'Weitere Kubernetes-Cluster'
                          : 'Verfügbare Kubernetes-Cluster'}
                      </span>
                    </div>
                    {standardRows.map(renderContextRow)}
                  </div>
                )}

                {savedViewRows.length > 0 && (
                  <div className="qs-group">
                    <div className="qs-group-heading">
                      <span>Gespeicherte Paletten-Ansichten</span>
                    </div>
                    {savedViewRows.map((item) => {
                      const view = item.savedView!
                      const idx = indexOfKey(item.key)
                      const isSelected = idx === selectedIndex
                      return (
                        <div
                          key={item.key}
                          data-quick-idx={idx}
                          className={`qs-row ${isSelected ? 'is-selected' : ''}`}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          onClick={() => void window.launcherApi.activateWorkspaceView(view)}
                        >
                          <div className="qs-row-left">
                            <ResourceCliBadge
                              category={view.category}
                              kindShort={view.kindShort}
                              compact
                            />
                            <div className="qs-row-copy">
                              <div className="qs-row-title-line">
                                <span className="qs-context-name">
                                  {getViewPrimaryLabel(view)}
                                </span>
                                <span className="qs-palette-tag">{item.paletteName}</span>
                              </div>
                              <div className="qs-row-sub">
                                <span className="qs-cluster-inline">
                                  ⎈ {view.clusterLabel}
                                </span>
                                {view.namespaces.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <span className="qs-ns-inline">
                                      ns:{view.namespaces.join(',')}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          {isSelected && <span className="qs-enter-hint">↵</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Keyboard Hint Footer */}
          <div className="qs-footer">
            <div className="qs-footer-hints">
              <span>
                <kbd>↑↓</kbd> Navigieren
              </span>
              <span>
                <kbd>↵</kbd> Cluster wechseln
              </span>
              <span>
                <kbd>{isMac ? '⌘F' : 'Strg+F'}</kbd> Favorit
              </span>
              <span>
                <kbd>Tab</kbd> Paletten
              </span>
            </div>
            <span className="qs-footer-count">{contexts.length} Kontexte</span>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================================
  // MODE 2: HORIZONTAL VIEW PALETTE DECK (WITH DRAG & DROP, LOCK & TRASH BIN)
  // ============================================================================
  const isDraggingSlot = Boolean(dragState?.dragging && dragState.source.kind === 'slot')
  const isDraggingLive = Boolean(dragState?.dragging && dragState.source.kind === 'live')
  const outsideDropActive =
    isDraggingSlot && dragState?.hoveredZone?.kind === 'outside' && !activePalette?.locked
  const trashDropActive =
    isDraggingSlot && dragState?.hoveredZone?.kind === 'trash' && !activePalette?.locked
  const hasFreeSlot = Boolean(activePalette?.slots.some((s) => s === null))

  return (
    <div
      className={`overlay-backdrop overlay-backdrop-glass palette-stage-backdrop ${
        outsideDropActive ? 'is-outside-drop-active' : ''
      }`}
      onMouseDown={handleBackdropClick}
    >
      {/* Contextual Banner when dragging a palette view out onto the live workspace */}
      {outsideDropActive && (
        <div className="outside-drop-banner">
          <ClusterHelmIcon size={15} />
          <span>
            {workspace.removeOnDragOutside
              ? 'Loslassen: Ansicht jetzt öffnen & aus der Palette herauslösen'
              : 'Loslassen: Ansicht im Arbeitsbereich öffnen'}
          </span>
        </div>
      )}

      <div className="palette-vertical-column" onMouseDown={(e) => e.stopPropagation()}>
        {/* ZONE 1: Floating "Current Live Radar View" Token ("outside, where I am right now") */}
        {workspace.liveView && (
          <div
            data-drop-zone="live-anchor"
            className={`live-view-anchor ${isDraggingLive ? 'is-dragging-source' : ''} ${
              activePalette?.locked ? 'is-palette-locked' : ''
            }`}
            onPointerDown={(e) => {
              if (!workspace.liveView) return
              beginPointerCandidate(e, { kind: 'live', view: workspace.liveView })
            }}
            title={
              activePalette?.locked
                ? 'Palette entsperren, um die aktuelle Ansicht in einen Slot zu ziehen'
                : 'Ziehen Sie Ihre aktuelle Ansicht unten in einen beliebigen Paletten-Slot'
            }
          >
            <div className="live-anchor-left">
              <span className="live-drag-handle">
                <DragGripIcon size={15} />
              </span>
              <span className="live-pulse-badge">
                <span className="live-pulse-dot" />
                <span>Aktuelle Ansicht</span>
              </span>
              <ResourceCliBadge
                category={workspace.liveView.category}
                kindShort={workspace.liveView.kindShort}
              />
              <span className="live-anchor-title">
                {getViewPrimaryLabel(workspace.liveView)}
              </span>
              <span className="k8s-chip k8s-chip-cluster">
                <ClusterHelmIcon size={12} />
                <span className="k8s-chip-text">{workspace.liveView.clusterLabel}</span>
              </span>
              <span
                className={`k8s-chip ${
                  workspace.liveView.namespaces.length > 0
                    ? 'k8s-chip-namespace'
                    : 'k8s-chip-namespace-all'
                }`}
              >
                <NamespaceCubeIcon size={11} />
                <span className="k8s-chip-prefix">ns:</span>
                <span className="k8s-chip-text">
                  {formatNamespaceSummary(workspace.liveView.namespaces).text}
                </span>
              </span>
            </div>

            <div className="live-anchor-right">
              {!activePalette?.locked && hasFreeSlot ? (
                <button
                  type="button"
                  className="live-pin-quick-btn"
                  onClick={handleQuickPinLiveView}
                  title="Aktuelle Ansicht in den nächsten freien Slot legen"
                >
                  + In Slot ablegen
                </button>
              ) : (
                <span className="live-drag-hint">
                  {activePalette?.locked
                    ? 'Palette gesperrt'
                    : 'In einen Slot unten ziehen'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ZONE 2: Horizontal Palette Deck */}
        {activePalette && (
          <div
            data-drop-zone="palette-shell"
            className={`palette-deck-shell ${activePalette.locked ? 'is-locked' : ''}`}
          >
            <div className="dialog-accent-bar" />

            {/* Palette Header: Name over the slots + Lock on the side + Mode Switcher */}
            <div className="palette-header">
              <div className="palette-header-left">
                <CaptainIcon size={20} />

                {workspace.palettes.length > 1 && (
                  <button
                    type="button"
                    className="palette-cycle-btn"
                    onClick={() => handleCyclePalette(-1)}
                    title="Vorherige Palette"
                  >
                    ‹
                  </button>
                )}

                {renamingPaletteId === activePalette.id ? (
                  <form className="palette-rename-form" onSubmit={handleCommitPaletteRename}>
                    <input
                      type="text"
                      className="palette-rename-input"
                      value={paletteNameDraft}
                      onChange={(e) => setPaletteNameDraft(e.target.value)}
                      onBlur={() => void handleCommitPaletteRename()}
                      autoFocus
                      maxLength={48}
                    />
                  </form>
                ) : (
                  <div className="palette-selector-group">
                    <select
                      className="palette-title-select"
                      value={activePalette.id}
                      onChange={(e) => void window.launcherApi.selectPalette(e.target.value)}
                      aria-label="Aktive Palette auswählen"
                    >
                      {workspace.palettes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.slots.filter(Boolean).length}/{workspace.slotCount})
                        </option>
                      ))}
                    </select>
                    {!activePalette.locked && (
                      <button
                        type="button"
                        className="palette-mini-btn"
                        onClick={handleStartPaletteRename}
                        title="Palettennamen bearbeiten"
                      >
                        Umbenennen
                      </button>
                    )}
                    <button
                      type="button"
                      className="palette-mini-btn"
                      onClick={() => void window.launcherApi.createPalette()}
                      title="Weitere Palette anlegen"
                    >
                      + Palette
                    </button>
                  </div>
                )}

                {workspace.palettes.length > 1 && (
                  <button
                    type="button"
                    className="palette-cycle-btn"
                    onClick={() => handleCyclePalette(1)}
                    title="Nächste Palette"
                  >
                    ›
                  </button>
                )}
              </div>

              <div className="palette-header-right">
                <button
                  type="button"
                  className="btn-ghost-icon"
                  onClick={() =>
                    void window.launcherApi.setWorkspaceOverlayMode('quick_switcher')
                  }
                  title="Zur Cluster-Schnellauswahl wechseln (Tab)"
                >
                  <ClusterHelmIcon size={13} />
                  <span>Cluster-Auswahl</span>
                </button>

                <button
                  type="button"
                  className={`palette-lock-btn ${activePalette.locked ? 'is-locked' : ''} ${
                    lockedNoticePulse ? 'is-pulsing' : ''
                  }`}
                  onClick={() =>
                    void window.launcherApi.setPaletteLocked(
                      activePalette.id,
                      !activePalette.locked
                    )
                  }
                  title={
                    activePalette.locked
                      ? 'Palette ist vor Änderungen geschützt — Klicken zum Entsperren'
                      : 'Palette sperren, um Ansichten fest zu verankern'
                  }
                >
                  <LockIcon locked={activePalette.locked} size={13} />
                  <span>{activePalette.locked ? 'Gesperrt' : 'Entsperrt'}</span>
                </button>

                <button
                  type="button"
                  className="btn-ghost-icon"
                  onClick={() => void window.launcherApi.openSettings()}
                  title={`Einstellungen (${formatShortcutKeycaps(preferences.shortcuts.openSettings, isMac).join('+')})`}
                >
                  <span>Einstellungen</span>
                </button>

                <button
                  type="button"
                  className="btn-ghost-icon"
                  onClick={() => void window.launcherApi.setWorkspaceOverlayMode('closed')}
                  title="Schließen (Esc)"
                >
                  <span>Esc</span>
                </button>
              </div>
            </div>

            {/* Horizontal Slots Grid (default 5 side-by-side slots) */}
            <div
              className="palette-slots-horizontal"
              style={{
                gridTemplateColumns: `repeat(${workspace.slotCount}, minmax(0, 1fr))`
              }}
            >
              {activePalette.slots.map((slotView, idx) => {
                const isHoveredSlotTarget =
                  dragState?.dragging &&
                  dragState.hoveredZone?.kind === 'slot' &&
                  dragState.hoveredZone.slotIndex === idx &&
                  !(
                    dragState.source.kind === 'slot' &&
                    dragState.source.slotIndex === idx
                  )

                const isSourceBeingDragged =
                  dragState?.dragging &&
                  dragState.source.kind === 'slot' &&
                  dragState.source.slotIndex === idx

                const isCurrentlyVisited =
                  slotView !== null &&
                  isSameWorkspaceDestination(slotView, workspace.liveView)

                const slotShortcutHint = preferences.enableSlotShortcuts
                  ? `${isMac ? '⌥' : 'Alt+'}${idx + 1}`
                  : `#${idx + 1}`

                if (!slotView) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      data-drop-zone="slot"
                      data-slot-index={idx}
                      className={`palette-slot-card is-empty ${
                        isHoveredSlotTarget ? 'is-drop-target' : ''
                      }`}
                    >
                      <div className="slot-top-meta">
                        <span className="slot-index-label">Slot {idx + 1}</span>
                        <span className="slot-kbd-pill">{slotShortcutHint}</span>
                      </div>

                      <div className="slot-empty-center">
                        <span className="slot-empty-text">
                          {isHoveredSlotTarget
                            ? 'Hier ablegen'
                            : activePalette.locked
                              ? 'Leer'
                              : 'Ansicht hierher ziehen'}
                        </span>
                        {!activePalette.locked && workspace.liveView && !isHoveredSlotTarget && (
                          <button
                            type="button"
                            className="slot-pin-here-btn"
                            onClick={() =>
                              void window.launcherApi.pinViewToSlot(
                                activePalette.id,
                                idx,
                                workspace.liveView!
                              )
                            }
                          >
                            + Aktuelle Ansicht
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <div
                    key={slotView.id || `slot-${idx}`}
                    data-drop-zone="slot"
                    data-slot-index={idx}
                    className={`palette-slot-card is-occupied ${
                      isHoveredSlotTarget ? 'is-drop-target' : ''
                    } ${isSourceBeingDragged ? 'is-dragging-origin' : ''} ${
                      isCurrentlyVisited ? 'is-current-view' : ''
                    }`}
                    onPointerDown={(e) =>
                      beginPointerCandidate(e, {
                        kind: 'slot',
                        paletteId: activePalette.id,
                        slotIndex: idx,
                        view: slotView
                      })
                    }
                  >
                    <div className="slot-top-meta">
                      <ResourceCliBadge
                        category={slotView.category}
                        kindShort={slotView.kindShort}
                        compact
                      />
                      <div className="slot-top-right">
                        {isCurrentlyVisited && (
                          <span className="slot-live-dot" title="Aktuell geöffnete Ansicht" />
                        )}
                        {!activePalette.locked && (
                          <button
                            type="button"
                            className="slot-edit-title-btn"
                            title="Anzeigenamen anpassen"
                            onClick={(e) => {
                              e.stopPropagation()
                              setRenamingSlotIndex(idx)
                              setSlotTitleDraft(getViewPrimaryLabel(slotView))
                            }}
                          >
                            ✎
                          </button>
                        )}
                        <span className="slot-kbd-pill">{slotShortcutHint}</span>
                      </div>
                    </div>

                    {renamingSlotIndex === idx ? (
                      <form
                        className="slot-rename-inline"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void handleCommitSlotRename(idx)
                        }}
                      >
                        <input
                          type="text"
                          className="slot-rename-input"
                          value={slotTitleDraft}
                          onChange={(e) => setSlotTitleDraft(e.target.value)}
                          onBlur={() => void handleCommitSlotRename(idx)}
                          autoFocus
                          maxLength={48}
                        />
                      </form>
                    ) : (
                      <ViewCoordinateBody view={slotView} />
                    )}

                    <div className="slot-footer-hint">
                      <span>Klicken zum Öffnen</span>
                      {!activePalette.locked && <DragGripIcon size={12} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ZONE 3: Trash Bin underneath the Palette + Visual Coordinate Legend */}
        <div className="palette-under-row">
          <div
            data-drop-zone="trash"
            className={`palette-trash-bin ${trashDropActive ? 'is-trash-active' : ''} ${
              isDraggingSlot && !activePalette?.locked ? 'is-awaiting-drop' : ''
            } ${activePalette?.locked ? 'is-disabled' : ''}`}
            title={
              activePalette?.locked
                ? 'Palette ist gesperrt'
                : 'Ziehen Sie eine Paletten-Ansicht hierher, um sie zu löschen'
            }
          >
            <TrashBinIcon size={15} />
            <span>
              {activePalette?.locked
                ? 'Papierkorb (Palette gesperrt)'
                : trashDropActive
                  ? 'Loslassen zum Entfernen aus der Palette'
                  : isDraggingSlot
                    ? 'Hier ablegen zum Löschen · Nach außen ziehen zum Öffnen & Lösen'
                    : 'Papierkorb · Ansicht hierher ziehen zum Entfernen'}
            </span>
          </div>

          <div className="palette-legend-bar" aria-label="Symbol-Legende">
            <span className="legend-item">
              <span className="legend-swatch legend-swatch-cluster">
                <ClusterHelmIcon size={11} />
              </span>
              <span>Grün = Cluster</span>
            </span>
            <span className="legend-sep">·</span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch-ns">
                <NamespaceCubeIcon size={11} />
              </span>
              <span>Blau = Namespace</span>
            </span>
            <span className="legend-sep">·</span>
            <span className="legend-item">
              <span className="legend-cli-mini">&gt;_</span>
              <span>Ressource / Ansicht</span>
            </span>
          </div>
        </div>
      </div>

      {/* Floating 60fps Ghost Card while dragging */}
      {dragState?.dragging && (
        <div
          className="palette-drag-ghost"
          style={{
            transform: `translate3d(${dragState.currentX + 12}px, ${dragState.currentY - 28}px, 0)`
          }}
        >
          <div className="ghost-top">
            <ResourceCliBadge
              category={dragState.source.view.category}
              kindShort={dragState.source.view.kindShort}
              compact
            />
            <span className="ghost-action-pill">
              {dragState.hoveredZone?.kind === 'trash'
                ? 'Löschen'
                : dragState.hoveredZone?.kind === 'outside'
                  ? workspace.removeOnDragOutside
                    ? 'Öffnen & Lösen'
                    : 'Öffnen'
                  : dragState.hoveredZone?.kind === 'slot'
                    ? `Slot ${dragState.hoveredZone.slotIndex + 1}`
                    : 'Verschieben'}
            </span>
          </div>
          <ViewCoordinateBody view={dragState.source.view} compact />
        </div>
      )}
    </div>
  )
}
