import type { ContextSummary, ViewResourceCategory, WorkspaceViewRef } from './types'

export interface ParsedRadarRoute {
  routePath: string
  category: ViewResourceCategory
  /** Clear, non-redundant Kubernetes resource or view type label (e.g. `Deployments`, `Pod`, `Topologie`). */
  kindName: string
  /** Specific focused resource or release name when viewing a detail page/drawer. */
  targetName?: string
  /** Active namespace scope (`[]` = all namespaces / cluster-wide). */
  namespaces: string[]
  /** True when the Kubernetes resource or Radar view is inherently cluster-scoped. */
  isClusterScoped: boolean
}

interface K8sKindSpec {
  category: ViewResourceCategory
  singular: string
  pluralLabel: string
  clusterScoped?: boolean
}

const K8S_PLURAL_SPECS: Record<string, K8sKindSpec> = {
  pods: { category: 'pods', singular: 'Pod', pluralLabel: 'Pods' },
  deployments: {
    category: 'workloads',
    singular: 'Deployment',
    pluralLabel: 'Deployments'
  },
  statefulsets: {
    category: 'workloads',
    singular: 'StatefulSet',
    pluralLabel: 'StatefulSets'
  },
  daemonsets: {
    category: 'workloads',
    singular: 'DaemonSet',
    pluralLabel: 'DaemonSets'
  },
  replicasets: {
    category: 'workloads',
    singular: 'ReplicaSet',
    pluralLabel: 'ReplicaSets'
  },
  jobs: { category: 'workloads', singular: 'Job', pluralLabel: 'Jobs' },
  cronjobs: {
    category: 'workloads',
    singular: 'CronJob',
    pluralLabel: 'CronJobs'
  },
  jobsets: {
    category: 'workloads',
    singular: 'JobSet',
    pluralLabel: 'JobSets'
  },
  horizontalpodautoscalers: {
    category: 'workloads',
    singular: 'Autoscaler',
    pluralLabel: 'Autoscaler'
  },
  services: {
    category: 'network',
    singular: 'Service',
    pluralLabel: 'Services'
  },
  ingresses: {
    category: 'network',
    singular: 'Ingress',
    pluralLabel: 'Ingresses'
  },
  endpoints: {
    category: 'network',
    singular: 'Endpoints',
    pluralLabel: 'Endpoints'
  },
  endpointslices: {
    category: 'network',
    singular: 'EndpointSlice',
    pluralLabel: 'EndpointSlices'
  },
  networkpolicies: {
    category: 'network',
    singular: 'NetworkPolicy',
    pluralLabel: 'NetworkPolicies'
  },
  gateways: {
    category: 'network',
    singular: 'Gateway',
    pluralLabel: 'Gateways'
  },
  httproutes: {
    category: 'network',
    singular: 'HTTPRoute',
    pluralLabel: 'HTTPRoutes'
  },
  configmaps: {
    category: 'config',
    singular: 'ConfigMap',
    pluralLabel: 'ConfigMaps'
  },
  secrets: {
    category: 'config',
    singular: 'Secret',
    pluralLabel: 'Secrets'
  },
  resourcequotas: {
    category: 'config',
    singular: 'ResourceQuota',
    pluralLabel: 'ResourceQuotas'
  },
  limitranges: {
    category: 'config',
    singular: 'LimitRange',
    pluralLabel: 'LimitRanges'
  },
  poddisruptionbudgets: {
    category: 'config',
    singular: 'DisruptionBudget',
    pluralLabel: 'DisruptionBudgets'
  },
  persistentvolumeclaims: {
    category: 'storage',
    singular: 'VolumeClaim',
    pluralLabel: 'VolumeClaims'
  },
  persistentvolumes: {
    category: 'storage',
    singular: 'PersistentVolume',
    pluralLabel: 'PersistentVolumes',
    clusterScoped: true
  },
  storageclasses: {
    category: 'storage',
    singular: 'StorageClass',
    pluralLabel: 'StorageClasses',
    clusterScoped: true
  },
  volumeattachments: {
    category: 'storage',
    singular: 'VolumeAttachment',
    pluralLabel: 'VolumeAttachments',
    clusterScoped: true
  },
  nodes: {
    category: 'nodes',
    singular: 'Node',
    pluralLabel: 'Nodes',
    clusterScoped: true
  },
  namespaces: {
    category: 'config',
    singular: 'Namespace',
    pluralLabel: 'Namespaces',
    clusterScoped: true
  },
  serviceaccounts: {
    category: 'rbac',
    singular: 'ServiceAccount',
    pluralLabel: 'ServiceAccounts'
  },
  roles: {
    category: 'rbac',
    singular: 'Role',
    pluralLabel: 'Roles'
  },
  rolebindings: {
    category: 'rbac',
    singular: 'RoleBinding',
    pluralLabel: 'RoleBindings'
  },
  clusterroles: {
    category: 'rbac',
    singular: 'ClusterRole',
    pluralLabel: 'ClusterRoles',
    clusterScoped: true
  },
  clusterrolebindings: {
    category: 'rbac',
    singular: 'ClusterRoleBinding',
    pluralLabel: 'ClusterRoleBindings',
    clusterScoped: true
  },
  events: {
    category: 'timeline',
    singular: 'Event',
    pluralLabel: 'Events'
  },
  customresourcedefinitions: {
    category: 'crd',
    singular: 'CustomResource',
    pluralLabel: 'Custom Resources',
    clusterScoped: true
  }
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function extractNamespaces(searchParams: URLSearchParams): string[] {
  const multi = searchParams.get('namespaces')
  if (multi) {
    return multi
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const single = searchParams.get('namespace')
  if (single && single.trim()) {
    return [single.trim()]
  }
  return []
}

function parseResourceQueryTarget(
  rawResource: string | null
): { namespace?: string; name?: string } {
  if (!rawResource) return {}
  const trimmed = rawResource.trim()
  if (!trimmed) return {}
  const slashIdx = trimmed.indexOf('/')
  if (slashIdx > 0 && slashIdx < trimmed.length - 1) {
    return {
      namespace: trimmed.slice(0, slashIdx),
      name: trimmed.slice(slashIdx + 1)
    }
  }
  return { name: trimmed }
}

function humanizeResourcePlural(slug: string): string {
  const clean = slug.replace(/[^a-zA-Z0-9-]/g, '')
  if (!clean) return 'Ressourcen'
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/**
 * Normalizes a full or relative Radar URL into a canonical, port-independent route path
 * (e.g. `/resources/deployments?namespaces=payments`).
 */
export function normalizeRadarRoutePath(rawUrlOrPath: string): string {
  const trimmed = (rawUrlOrPath || '').trim()
  if (!trimmed) return '/'

  try {
    const parsed =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? new URL(trimmed)
        : new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, 'http://radar.local')
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
}

/**
 * Deterministically parses a Radar SPA route into a clean Kubernetes hierarchy
 * (Cluster → Namespace/Scope → Kind/Target) with zero API calls.
 */
export function parseRadarRoute(rawUrlOrPath: string, pageTitle?: string): ParsedRadarRoute {
  const routePath = normalizeRadarRoutePath(rawUrlOrPath)
  const parsed = new URL(routePath, 'http://radar.local')
  const segments = parsed.pathname
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map(safeDecode)

  const queryNamespaces = extractNamespaces(parsed.searchParams)
  const root = (segments[0] || '').toLowerCase()

  // 1. Overview / Home
  if (!root || root === 'home') {
    return {
      routePath,
      category: 'overview',
      kindName: 'Übersicht',
      namespaces: queryNamespaces,
      isClusterScoped: false
    }
  }

  // 2. Topology (/topology?mode=traffic&namespaces=...)
  if (root === 'topology') {
    const mode = parsed.searchParams.get('mode')
    return {
      routePath,
      category: 'topology',
      kindName: mode === 'traffic' ? 'Traffic-Topologie' : 'Topologie',
      namespaces: queryNamespaces,
      isClusterScoped: false
    }
  }

  // 3. Fullscreen Workload route: /workload/:kind/:namespace/:name
  if (root === 'workload') {
    const kindSlug = (segments[1] || '').toLowerCase()
    const isSentinelClusterScope = segments[2] === '_'
    const nsSegment = segments[2] && !isSentinelClusterScope ? segments[2] : undefined
    const targetName = segments.slice(3).join('/') || undefined
    const spec = K8S_PLURAL_SPECS[kindSlug]
    const namespaces = nsSegment
      ? Array.from(new Set([nsSegment, ...queryNamespaces]))
      : isSentinelClusterScope
        ? []
        : queryNamespaces

    return {
      routePath,
      category: spec?.category ?? 'workloads',
      kindName: spec ? spec.singular : humanizeResourcePlural(kindSlug),
      targetName,
      namespaces,
      isClusterScoped: Boolean(spec?.clusterScoped || isSentinelClusterScope)
    }
  }

  // 4. Resources list or detail drawer: /resources/:plural?resource=ns/name&namespaces=...
  if (root === 'resources') {
    const pluralSlug = (segments[1] || '').toLowerCase()
    const focused = parseResourceQueryTarget(parsed.searchParams.get('resource'))
    const namespaces = focused.namespace
      ? Array.from(new Set([focused.namespace, ...queryNamespaces]))
      : queryNamespaces

    if (!pluralSlug) {
      return {
        routePath,
        category: 'crd',
        kindName: 'Ressourcen',
        namespaces,
        isClusterScoped: false
      }
    }

    const spec = K8S_PLURAL_SPECS[pluralSlug]
    if (spec) {
      return {
        routePath,
        category: spec.category,
        kindName: focused.name ? spec.singular : spec.pluralLabel,
        targetName: focused.name,
        namespaces: spec.clusterScoped ? [] : namespaces,
        isClusterScoped: Boolean(spec.clusterScoped)
      }
    }

    const cleanPageTitle = pageTitle?.replace(/\s*[·|-]\s*Radar$/i, '').trim()
    return {
      routePath,
      category: 'crd',
      kindName: cleanPageTitle || humanizeResourcePlural(pluralSlug),
      targetName: focused.name,
      namespaces,
      isClusterScoped: false
    }
  }

  // 5. Helm (/helm or /helm/compare)
  if (root === 'helm') {
    const release = parseResourceQueryTarget(
      parsed.searchParams.get('release') || parsed.searchParams.get('resource')
    )
    const isCompare = (segments[1] || '').toLowerCase() === 'compare'
    return {
      routePath,
      category: 'helm',
      kindName: isCompare ? 'Helm-Vergleich' : release.name ? 'Helm Release' : 'Helm Releases',
      targetName: release.name,
      namespaces: release.namespace
        ? Array.from(new Set([release.namespace, ...queryNamespaces]))
        : queryNamespaces,
      isClusterScoped: false
    }
  }

  // 6. GitOps (/gitops or /gitops/detail/:kind/:ns/:name)
  if (root === 'gitops') {
    const isDetail = (segments[1] || '').toLowerCase() === 'detail'
    const detailNs = isDetail && segments[3] && segments[3] !== '_' ? segments[3] : undefined
    const detailName = isDetail ? segments[4] : undefined
    return {
      routePath,
      category: 'gitops',
      kindName: 'GitOps',
      targetName: detailName,
      namespaces: detailNs
        ? Array.from(new Set([detailNs, ...queryNamespaces]))
        : queryNamespaces,
      isClusterScoped: false
    }
  }

  // 7. Applications (/applications?app=ns/name)
  if (root === 'applications') {
    const appTarget = parseResourceQueryTarget(parsed.searchParams.get('app'))
    return {
      routePath,
      category: 'applications',
      kindName: appTarget.name ? 'Applikation' : 'Applikationen',
      targetName: appTarget.name,
      namespaces: appTarget.namespace
        ? Array.from(new Set([appTarget.namespace, ...queryNamespaces]))
        : queryNamespaces,
      isClusterScoped: false
    }
  }

  // 8. Issues / Warnings
  if (root === 'issues') {
    return {
      routePath,
      category: 'issues',
      kindName: 'Probleme',
      namespaces: queryNamespaces,
      isClusterScoped: false
    }
  }

  // 9. Event Timeline
  if (root === 'timeline') {
    return {
      routePath,
      category: 'timeline',
      kindName: 'Events',
      namespaces: queryNamespaces,
      isClusterScoped: false
    }
  }

  // 10. Live Service Traffic
  if (root === 'traffic') {
    return {
      routePath,
      category: 'traffic',
      kindName: 'Service-Traffic',
      namespaces: queryNamespaces,
      isClusterScoped: false
    }
  }

  // 11. Cost & Capacity
  if (root === 'cost' || root === 'capacity') {
    const isRightsizing = (segments[1] || '').toLowerCase() === 'rightsizing'
    return {
      routePath,
      category: 'cost',
      kindName: root === 'capacity' ? 'Kapazität' : 'Kosten',
      namespaces: root === 'cost' && !isRightsizing ? [] : queryNamespaces,
      isClusterScoped: root === 'cost' && !isRightsizing
    }
  }

  // 12. Cluster Checks / Audit / Upgrade readiness
  if (root === 'checks' || root === 'audit') {
    const isUpgrade = (segments[1] || '').toLowerCase() === 'upgrade'
    return {
      routePath,
      category: 'checks',
      kindName: isUpgrade ? 'Upgrade-Prüfung' : 'Cluster-Checks',
      namespaces: isUpgrade ? [] : queryNamespaces,
      isClusterScoped: isUpgrade
    }
  }

  // Fallback for workspace extensions
  return {
    routePath,
    category: 'crd',
    kindName: humanizeResourcePlural(root),
    namespaces: queryNamespaces,
    isClusterScoped: false
  }
}

export function deriveClusterDisplayName(
  contextName: string,
  contexts: ContextSummary[]
): { clusterLabel: string; isTeleport: boolean; defaultNamespace?: string } {
  const summary = contexts.find((c) => c.name === contextName)
  if (!summary) {
    return {
      clusterLabel: contextName || 'Kein Cluster',
      isTeleport: false
    }
  }

  const kubeCluster = summary.teleport.kubeCluster?.trim()
  const clusterLabel = kubeCluster || summary.name
  return {
    clusterLabel,
    isTeleport: summary.teleport.isTeleport,
    defaultNamespace: summary.namespace
  }
}

export function buildWorkspaceViewRef(params: {
  id: string
  context: string
  contexts: ContextSummary[]
  rawUrlOrPath: string
  pageTitle?: string
  customTitle?: string
  createdAt?: number
}): WorkspaceViewRef {
  const parsed = parseRadarRoute(params.rawUrlOrPath, params.pageTitle)
  const clusterMeta = deriveClusterDisplayName(params.context, params.contexts)

  return {
    id: params.id,
    context: params.context,
    clusterLabel: clusterMeta.clusterLabel,
    isTeleport: clusterMeta.isTeleport,
    routePath: parsed.routePath,
    category: parsed.category,
    kindName: parsed.kindName,
    targetName: parsed.targetName,
    namespaces: parsed.namespaces,
    isClusterScoped: parsed.isClusterScoped,
    customTitle: params.customTitle,
    createdAt: params.createdAt ?? Date.now()
  }
}

export function getViewPrimaryLabel(view: WorkspaceViewRef): string {
  if (view.customTitle && view.customTitle.trim()) {
    return view.customTitle.trim()
  }
  if (view.targetName) {
    return view.targetName
  }
  return view.kindName
}

export function isSameWorkspaceDestination(
  a: Pick<WorkspaceViewRef, 'context' | 'routePath'> | null | undefined,
  b: Pick<WorkspaceViewRef, 'context' | 'routePath'> | null | undefined
): boolean {
  if (!a || !b) return false
  return (
    a.context === b.context &&
    normalizeRadarRoutePath(a.routePath) === normalizeRadarRoutePath(b.routePath)
  )
}
