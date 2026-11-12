import React from 'react'
import { getViewPrimaryLabel } from '@shared/radar-route'
import type { WorkspaceViewRef } from '@shared/types'
import {
  ClusterHelmIcon,
  NamespaceCubeIcon,
  ResourceCategoryIcon
} from './K8sIcons'

export interface ViewCardProps {
  view: WorkspaceViewRef
  /** 1-based slot number (1..5) when rendered inside a palette slot. */
  slotNumber?: number
  /** Highlights the card with a subtle live indicator when it matches the active Radar screen. */
  isActiveNow?: boolean
  /** Marks the card when hovered as a swap target in the palette. */
  isDropTarget?: boolean
  /** Visual state while lifted under the pointer (`'move'` | `'trash'` | `'visit'`). */
  dragTone?: 'move' | 'trash' | 'visit'
  style?: React.CSSProperties
  className?: string
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
}

function formatScopeNode(view: WorkspaceViewRef): { label: string; isScoped: boolean } {
  if (view.namespaces && view.namespaces.length > 0) {
    if (view.namespaces.length === 1) {
      return { label: view.namespaces[0], isScoped: true }
    }
    return {
      label: `${view.namespaces[0]} +${view.namespaces.length - 1}`,
      isScoped: true
    }
  }
  return {
    label: view.isClusterScoped ? 'Clusterweit' : 'Alle Namespaces',
    isScoped: false
  }
}

/**
 * Unified, non-redundant View representation used identically for:
 *  1. The Current View above the palette
 *  2. Occupied Slots 1–5 inside the palette
 *  3. The floating card during drag-and-drop (preserving exact dimensions)
 *
 * Displays the top-down Kubernetes hierarchy:
 *   ⎈ Cluster (emerald root)
 *   ├─ ⬡ Namespace / Scope
 *   └─ [Icon] Resource / View (stated once)
 */
export const ViewCard: React.FC<ViewCardProps> = ({
  view,
  slotNumber,
  isActiveNow = false,
  isDropTarget = false,
  dragTone,
  style,
  className = '',
  onPointerDown
}) => {
  const scope = formatScopeNode(view)
  const primaryLabel = getViewPrimaryLabel(view)

  // Only show a kind eyebrow when focusing a specific named object (e.g. Deployment -> checkout-api)
  // or when the user set a custom title. List/surface views (Pods, Topologie, Helm Releases) state their name once.
  const kindEyebrow =
    view.customTitle?.trim()
      ? view.targetName
        ? `${view.kindName} · ${view.targetName}`
        : view.kindName
      : view.targetName
        ? view.kindName
        : null

  const classes = [
    'view-card',
    isActiveNow ? 'is-active-now' : '',
    isDropTarget ? 'is-drop-target' : '',
    dragTone ? `is-dragging is-drag-${dragTone}` : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      style={style}
      onPointerDown={onPointerDown}
      title={`${view.clusterLabel || view.context} › ${scope.label} › ${
        kindEyebrow ? `${kindEyebrow}: ${primaryLabel}` : primaryLabel
      }`}
    >
      <div className="view-card-tree">
        {/* Precision geometric tree rails connecting Cluster (x=11, y=22) -> Namespace (y=44) -> Resource (y=86) */}
        <svg
          className="view-tree-rails"
          width="24"
          height="104"
          viewBox="0 0 24 104"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M 11 23 V 80 Q 11 86 17 86 H 21"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M 11 44 H 20"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        {/* LEVEL 1: Cluster Root (Emerald Green + 7-Spoke Kubernetes Wheel) */}
        <div className="view-tree-cluster-row">
          <span className="view-cluster-badge">
            <ClusterHelmIcon size={13} />
          </span>
          <span className="view-cluster-name">{view.clusterLabel || view.context}</span>

          <div className="view-card-corner">
            {isActiveNow && <span className="view-live-dot" aria-hidden="true" />}
            {slotNumber !== undefined && (
              <span className="view-slot-num">{slotNumber}</span>
            )}
          </div>
        </div>

        {/* LEVEL 2: Namespace / Scope Branch */}
        <div
          className={`view-tree-scope-row ${
            scope.isScoped ? 'is-scoped' : 'is-unscoped'
          }`}
        >
          <NamespaceCubeIcon size={12} />
          <span className="view-scope-text">{scope.label}</span>
        </div>

        {/* LEVEL 3: Target Resource / View Leaf (Single non-redundant label) */}
        <div className="view-tree-leaf-row">
          <span className={`view-leaf-icon view-cat-${view.category}`}>
            <ResourceCategoryIcon category={view.category} size={15} />
          </span>
          <div className="view-leaf-copy">
            {kindEyebrow && <span className="view-leaf-eyebrow">{kindEyebrow}</span>}
            <span className="view-leaf-title">{primaryLabel}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
