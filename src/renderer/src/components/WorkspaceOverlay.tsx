import React, { useEffect, useMemo, useState, useRef } from 'react'
import { isSameWorkspaceDestination } from '@shared/radar-route'
import { PALETTE_SLOT_COUNT, type WorkspaceOrganizerState, type WorkspacePalette, type WorkspaceViewRef } from '@shared/types'
import { ChevronIcon, LockIcon, PlusIcon, TrashBinIcon } from './K8sIcons'
import { ViewCard } from './ViewCard'

interface WorkspaceOverlayProps {
  workspace: WorkspaceOrganizerState
}

type DragSource =
  | { kind: 'live'; view: WorkspaceViewRef }
  | { kind: 'slot'; paletteId: string; slotIndex: number; view: WorkspaceViewRef }

type DropZone =
  | { kind: 'slot'; slotIndex: number }
  | { kind: 'trash' }
  | { kind: 'outside' }
  | { kind: 'neutral' }

interface ActivePointerDrag {
  source: DragSource
  startX: number
  startY: number
  currentX: number
  currentY: number
  grabOffsetX: number
  grabOffsetY: number
  cardWidth: number
  cardHeight: number
  dragging: boolean
  hoveredZone: DropZone
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
      if (Number.isInteger(idx) && idx >= 0 && idx < PALETTE_SLOT_COUNT) {
        return { kind: 'slot', slotIndex: idx }
      }
    }
    if (zoneAttr === 'trash') {
      return source.kind === 'slot' ? { kind: 'trash' } : { kind: 'neutral' }
    }
    if (zoneAttr === 'palette-shell' || zoneAttr === 'live-dock') {
      return { kind: 'neutral' }
    }
  }
  return source.kind === 'slot' ? { kind: 'outside' } : { kind: 'neutral' }
}

export const WorkspaceOverlay: React.FC<WorkspaceOverlayProps> = ({ workspace }) => {
  const [renamingPalette, setRenamingPalette] = useState(false)
  const [paletteNameDraft, setPaletteNameDraft] = useState('')
  const [lockPulse, setLockPulse] = useState(false)
  const [dragState, setDragState] = useState<ActivePointerDrag | null>(null)
  const dragRef = useRef<ActivePointerDrag | null>(null)

  const activePalette: WorkspacePalette | undefined = useMemo(
    () =>
      workspace.palettes.find((p) => p.id === workspace.activePaletteId) ??
      workspace.palettes[0],
    [workspace.palettes, workspace.activePaletteId]
  )

  useEffect(() => {
    setRenamingPalette(false)
  }, [workspace.overlayMode, activePalette?.id])

  const cyclePalette = (delta: number): void => {
    if (workspace.palettes.length <= 1 || !activePalette) return
    const idx = workspace.palettes.findIndex((p) => p.id === activePalette.id)
    const nextIdx = (idx + delta + workspace.palettes.length) % workspace.palettes.length
    void window.launcherApi.selectPalette(workspace.palettes[nextIdx].id)
  }

  // Keyboard navigation while the palette is open
  useEffect(() => {
    if (workspace.overlayMode !== 'palette') return undefined

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (dragRef.current?.dragging) {
          e.preventDefault()
          dragRef.current = null
          setDragState(null)
          return
        }
        if (renamingPalette) {
          e.preventDefault()
          setRenamingPalette(false)
          return
        }
        e.preventDefault()
        void window.launcherApi.setWorkspaceOverlayMode('closed')
        return
      }

      if (renamingPalette || e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        cyclePalette(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        cyclePalette(1)
      } else if (/^[1-5]$/.test(e.key) && activePalette) {
        const slotIdx = Number(e.key) - 1
        const slotView = activePalette.slots[slotIdx]
        if (slotView) {
          e.preventDefault()
          void window.launcherApi.activateWorkspaceView(slotView)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspace.overlayMode, workspace.palettes, activePalette, renamingPalette])

  const activePaletteRef = useRef<WorkspacePalette | undefined>(activePalette)
  activePaletteRef.current = activePalette

  // Precision pointer drag-and-drop lifecycle (zero card warping, zero missed fast flicks)
  useEffect(() => {
    if (workspace.overlayMode !== 'palette') return undefined

    const handlePointerMove = (e: PointerEvent): void => {
      const current = dragRef.current
      if (!current) return
      const movedEnough =
        current.dragging ||
        Math.hypot(e.clientX - current.startX, e.clientY - current.startY) > 5

      if (!movedEnough) return

      const pal = activePaletteRef.current
      if (pal?.locked) {
        dragRef.current = null
        setDragState(null)
        setLockPulse(true)
        setTimeout(() => setLockPulse(false), 500)
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
      if (!current) return
      dragRef.current = null
      setDragState(null)

      if (!current.dragging) {
        if (current.source.kind === 'slot') {
          void window.launcherApi.activateWorkspaceView(current.source.view)
        } else {
          void window.launcherApi.setWorkspaceOverlayMode('closed')
        }
        return
      }

      const pal = activePaletteRef.current
      if (!pal || pal.locked) return

      const drop = resolveDropZoneAtPoint(e.clientX, e.clientY, current.source)

      if (drop.kind === 'slot') {
        if (current.source.kind === 'live') {
          void window.launcherApi.pinViewToSlot(
            pal.id,
            drop.slotIndex,
            current.source.view
          )
        } else if (current.source.slotIndex !== drop.slotIndex) {
          void window.launcherApi.movePaletteSlot(
            pal.id,
            current.source.slotIndex,
            drop.slotIndex
          )
        }
      } else if (drop.kind === 'trash' && current.source.kind === 'slot') {
        void window.launcherApi.removePaletteSlot(
          current.source.paletteId,
          current.source.slotIndex
        )
      } else if (drop.kind === 'outside' && current.source.kind === 'slot') {
        void window.launcherApi.activateWorkspaceView(current.source.view, {
          removeFromSlot: {
            paletteId: current.source.paletteId,
            slotIndex: current.source.slotIndex
          }
        })
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      dragRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [workspace.overlayMode])

  if (workspace.overlayMode !== 'palette' || !activePalette) {
    return null
  }

  const beginCardPointer = (
    e: React.PointerEvent<HTMLDivElement>,
    source: DragSource
  ): void => {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const initial: ActivePointerDrag = {
      source,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
      cardWidth: rect.width,
      cardHeight: rect.height,
      dragging: false,
      hoveredZone: { kind: 'neutral' }
    }
    dragRef.current = initial
    setDragState(initial)
  }

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || dragRef.current?.dragging) return
    void window.launcherApi.setWorkspaceOverlayMode('closed')
  }

  const handleBeginRename = (): void => {
    if (activePalette.locked) {
      setLockPulse(true)
      setTimeout(() => setLockPulse(false), 500)
      return
    }
    setPaletteNameDraft(activePalette.name)
    setRenamingPalette(true)
  }

  const handleCommitRename = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    const trimmed = paletteNameDraft.trim()
    if (trimmed && trimmed !== activePalette.name) {
      await window.launcherApi.renamePalette(activePalette.id, trimmed)
    }
    setRenamingPalette(false)
  }

  const isDragging = Boolean(dragState?.dragging)
  const isDraggingSlot = Boolean(dragState?.dragging && dragState.source.kind === 'slot')
  const isDraggingLive = Boolean(dragState?.dragging && dragState.source.kind === 'live')
  const outsideActive =
    isDraggingSlot && dragState?.hoveredZone.kind === 'outside' && !activePalette.locked
  const trashActive =
    isDraggingSlot && dragState?.hoveredZone.kind === 'trash' && !activePalette.locked

  const floatingTone: 'move' | 'trash' | 'visit' = trashActive
    ? 'trash'
    : outsideActive
      ? 'visit'
      : 'move'

  return (
    <div
      className={`overlay-backdrop overlay-backdrop-glass palette-stage ${
        outsideActive ? 'is-outside-active' : ''
      }`}
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="palette-stack" onMouseDown={(e) => e.stopPropagation()}>
        {/* 1. Current View Card outside/above the palette (identical ViewCard geometry) */}
        {workspace.liveView && (
          <div
            data-drop-zone="live-dock"
            className={`live-card-dock ${isDraggingLive ? 'is-lifted' : ''}`}
          >
            <ViewCard
              view={workspace.liveView}
              isActiveNow={true}
              className="is-live-origin-card"
              onPointerDown={(e) =>
                beginCardPointer(e, { kind: 'live', view: workspace.liveView! })
              }
            />
          </div>
        )}

        {/* 2. Horizontal 5-Slot Palette Bar */}
        <div
          data-drop-zone="palette-shell"
          className={`palette-bar-shell ${activePalette.locked ? 'is-locked' : ''}`}
        >
          <div className="palette-bar-header">
            <div className="palette-header-side" />

            {/* Palette Name & Switcher centered over the 5 slots */}
            <div className="palette-title-center">
              {workspace.palettes.length > 1 && (
                <button
                  type="button"
                  className="palette-icon-btn"
                  onClick={() => cyclePalette(-1)}
                  title="Vorherige Palette (←)"
                >
                  <ChevronIcon direction="left" size={14} />
                </button>
              )}

              {renamingPalette ? (
                <form className="palette-title-form" onSubmit={handleCommitRename}>
                  <input
                    type="text"
                    className="palette-title-input"
                    value={paletteNameDraft}
                    onChange={(e) => setPaletteNameDraft(e.target.value)}
                    onBlur={() => void handleCommitRename()}
                    autoFocus
                    maxLength={48}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className={`palette-title-trigger ${
                    activePalette.locked ? 'is-readonly' : ''
                  }`}
                  onClick={handleBeginRename}
                  title={
                    activePalette.locked
                      ? activePalette.name
                      : 'Klicken zum Umbenennen'
                  }
                >
                  <span>{activePalette.name}</span>
                </button>
              )}

              {workspace.palettes.length > 1 && (
                <button
                  type="button"
                  className="palette-icon-btn"
                  onClick={() => cyclePalette(1)}
                  title="Nächste Palette (→)"
                >
                  <ChevronIcon direction="right" size={14} />
                </button>
              )}

              <button
                type="button"
                className="palette-icon-btn palette-add-btn"
                onClick={() => void window.launcherApi.createPalette()}
                title="Neue Palette erstellen"
              >
                <PlusIcon size={13} />
              </button>
            </div>

            {/* Icon-only Lock on the side */}
            <div className="palette-header-side is-right">
              <button
                type="button"
                className={`palette-lock-icon-btn ${
                  activePalette.locked ? 'is-locked' : ''
                } ${lockPulse ? 'is-pulsing' : ''}`}
                onClick={() =>
                  void window.launcherApi.setPaletteLocked(
                    activePalette.id,
                    !activePalette.locked
                  )
                }
                title={activePalette.locked ? 'Palette entsperren' : 'Palette sperren'}
                aria-label={activePalette.locked ? 'Palette entsperren' : 'Palette sperren'}
              >
                <LockIcon locked={activePalette.locked} size={14} />
              </button>
            </div>
          </div>

          {workspace.palettes.length > 1 && (
            <div className="palette-dots-row" role="tablist">
              {workspace.palettes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={p.id === activePalette.id}
                  className={`palette-dot ${p.id === activePalette.id ? 'is-active' : ''}`}
                  onClick={() => void window.launcherApi.selectPalette(p.id)}
                  title={p.name}
                />
              ))}
            </div>
          )}

          {/* Always 5 Horizontal Slots */}
          <div className="palette-five-grid">
            {Array.from({ length: PALETTE_SLOT_COUNT }).map((_, idx) => {
              const slotView = activePalette.slots[idx] ?? null

              const isSlotHovered =
                isDragging &&
                dragState?.hoveredZone.kind === 'slot' &&
                dragState.hoveredZone.slotIndex === idx &&
                !(dragState.source.kind === 'slot' && dragState.source.slotIndex === idx)

              const isOriginLifted =
                isDragging &&
                dragState?.source.kind === 'slot' &&
                dragState.source.slotIndex === idx

              if (!slotView || isOriginLifted) {
                return (
                  <div
                    key={`well-${idx}`}
                    data-drop-zone="slot"
                    data-slot-index={idx}
                    className={`palette-slot-well ${
                      isSlotHovered ? 'is-drop-target' : ''
                    }`}
                  >
                    <span className="slot-well-num">{idx + 1}</span>
                  </div>
                )
              }

              const isActiveNow = isSameWorkspaceDestination(
                slotView,
                workspace.liveView
              )

              return (
                <div
                  key={slotView.id || `slot-${idx}`}
                  data-drop-zone="slot"
                  data-slot-index={idx}
                  className="palette-slot-cell"
                >
                  <ViewCard
                    view={slotView}
                    slotNumber={idx + 1}
                    isActiveNow={isActiveNow}
                    isDropTarget={isSlotHovered}
                    onPointerDown={(e) =>
                      beginCardPointer(e, {
                        kind: 'slot',
                        paletteId: activePalette.id,
                        slotIndex: idx,
                        view: slotView
                      })
                    }
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* 3. Icon-only Trash Bin underneath the palette */}
        <div
          data-drop-zone="trash"
          className={`palette-bin-well ${trashActive ? 'is-active' : ''} ${
            isDraggingSlot && !activePalette.locked ? 'is-ready' : ''
          } ${activePalette.locked ? 'is-locked' : ''}`}
          aria-label="Papierkorb"
        >
          <TrashBinIcon size={16} />
        </div>
      </div>

      {/* Pixel-exact floating ViewCard during drag (zero warping) */}
      {dragState?.dragging && (
        <ViewCard
          view={dragState.source.view}
          slotNumber={
            dragState.source.kind === 'slot'
              ? dragState.source.slotIndex + 1
              : undefined
          }
          dragTone={floatingTone}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: `${dragState.cardWidth}px`,
            height: `${dragState.cardHeight}px`,
            transform: `translate3d(${Math.round(
              dragState.currentX - dragState.grabOffsetX
            )}px, ${Math.round(dragState.currentY - dragState.grabOffsetY)}px, 0)`
          }}
        />
      )}
    </div>
  )
}
