import React from 'react'
import type { ViewResourceCategory } from '@shared/types'

interface IconProps {
  size?: number
  className?: string
}

/**
 * 7-spoke Kubernetes Cluster Helm / Heptagon Wheel emblem.
 */
export const ClusterHelmIcon: React.FC<IconProps> = ({ size = 13, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <polygon points="12 2 19.8 5.8 21.7 14.2 16.3 21 7.7 21 2.3 14.2 4.2 5.8" />
    <circle cx="12" cy="12" r="3.1" />
    <line x1="12" y1="5" x2="12" y2="8.9" />
    <line x1="17.4" y1="7.7" x2="14.5" y2="10" />
    <line x1="18.6" y1="13.8" x2="15.1" y2="12.8" />
    <line x1="14.9" y1="18.2" x2="13.3" y2="14.9" />
    <line x1="9.1" y1="18.2" x2="10.7" y2="14.9" />
    <line x1="5.4" y1="13.8" x2="8.9" y2="12.8" />
    <line x1="6.6" y1="7.7" x2="9.5" y2="10" />
  </svg>
)

/**
 * Kubernetes Namespace scope hexagon.
 */
export const NamespaceCubeIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5z" strokeDasharray="3.2 2.4" />
    <polyline points="4.5 7.3 12 11.8 19.5 7.3" />
    <line x1="12" y1="11.8" x2="12" y2="21" />
  </svg>
)

/**
 * Distinct vector glyphs for Kubernetes resource kinds and Radar workspace surfaces.
 */
export const ResourceCategoryIcon: React.FC<{
  category: ViewResourceCategory
  size?: number
}> = ({ category, size = 14 }) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
  }

  switch (category) {
    case 'overview':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      )
    case 'topology':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <line x1="8.2" y1="7.2" x2="10.8" y2="15.8" />
          <line x1="15.8" y1="7.2" x2="13.2" y2="15.8" />
          <line x1="8.5" y1="6" x2="15.5" y2="6" />
        </svg>
      )
    case 'pods':
      return (
        <svg {...common}>
          <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5z" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'workloads':
      return (
        <svg {...common}>
          <polygon points="12 2.5 21 7.5 12 12.5 3 7.5 12 2.5" />
          <polyline points="3 12.5 12 17.5 21 12.5" />
          <polyline points="3 17 12 22 21 17" />
        </svg>
      )
    case 'network':
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="2.5" />
          <circle cx="19" cy="6" r="2.5" />
          <circle cx="19" cy="18" r="2.5" />
          <path d="M7.5 11 16.5 7" />
          <path d="M7.5 13 16.5 17" />
        </svg>
      )
    case 'config':
      return (
        <svg {...common}>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="17" x2="20" y2="17" />
          <circle cx="9" cy="7" r="2.5" fill="currentColor" />
          <circle cx="15" cy="17" r="2.5" fill="currentColor" />
        </svg>
      )
    case 'storage':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </svg>
      )
    case 'nodes':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
          <line x1="7" y1="17" x2="7.01" y2="17" />
        </svg>
      )
    case 'rbac':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      )
    case 'helm':
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <path d="M5 8l14 8" />
          <path d="M19 8 5 16" />
          <circle cx="12" cy="12" r="5" />
        </svg>
      )
    case 'gitops':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <line x1="6" y1="8.5" x2="6" y2="15.5" />
          <path d="M18 10.5c0 4.5-4 5.5-12 5.5" />
        </svg>
      )
    case 'applications':
      return (
        <svg {...common}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
        </svg>
      )
    case 'issues':
      return (
        <svg {...common}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'timeline':
      return (
        <svg {...common}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      )
    case 'traffic':
      return (
        <svg {...common}>
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
        </svg>
      )
    case 'cost':
      return (
        <svg {...common}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      )
    case 'checks':
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      )
  }
}

export const LockIcon: React.FC<{ locked: boolean; size?: number }> = ({
  locked,
  size = 15
}) =>
  locked ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  )

export const TrashBinIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

export const PlusIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const ChevronIcon: React.FC<{ direction: 'left' | 'right'; size?: number }> = ({
  direction,
  size = 14
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {direction === 'left' ? (
      <polyline points="15 18 9 12 15 6" />
    ) : (
      <polyline points="9 18 15 12 9 6" />
    )}
  </svg>
)
