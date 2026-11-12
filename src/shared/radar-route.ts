import type { ContextSummary, ViewResourceCategory, WorkspaceViewRef } from './types'

export interface ParsedRadarRoute {
  routePath: string
  category: ViewResourceCategory
  /** Official `kubectl` shortname or CLI surface token (e.g. `po`, `deploy`, `svc`, `topo`). */
  kindShort: string
  /** Clear Kubernetes resource / view type label (e.g. `Deployments`, `Pods`, `Topologie`). */
  kindName: string
  /** Specific focused resource or release name when viewing a detail page/drawer. */
  targetName?: string
  /** Active namespace scope (`[]` = all namespaces / cluster-wide). */
  namespaces: string[]
}

interface K8sKindSpec {
  category: ViewResourceCategory
  short: string
  singular: string
  pluralLabel: string
}

/**
 * Canonical Kubernetes resource taxonomy using official `kubectl api-resources` shortnames.
 */
const K8S_PLURAL_SPECS: Record<string, K8sKindSpec> = {
  pods: { category: 'pods', short: 'po', singular: 'Pod', pluralLabel: 'Pods' },
  deployments: {
    category: 'workloads',
    short: 'deploy',
    singular: 'Deployment',
    pluralLabel: 'Deployments'
  },
  statefulsets: {
    category: 'workloads',
    short: 'sts',
    singular: 'StatefulSet',
    pluralLabel: 'StatefulSets'
  },
  daemonsets: {
    category: 'workloads',
    short: 'ds',
    singular: 'DaemonSet',
    pluralLabel: 'DaemonSets'
  },
  replicasets: {
    category: 'workloads',
    short: 'rs',
    singular: 'ReplicaSet',
    pluralLabel: 'ReplicaSets'
  },
  jobs: { category: 'workloads', short: 'job', singular: 'Job', pluralLabel: 'Jobs' },
  cronjobs: {
    category: 'workloads',
    short: 'cj',
    singular: 'CronJob',
    pluralLabel: 'CronJobs'
  },
  jobsets: {
    category: 'workloads',
    short: 'jobset',
    singular: 'JobSet',
    pluralLabel: 'JobSets'
  },
  horizontalpodautoscalers: {
    category: 'workloads',
    short: 'hpa',
    singular: 'HPA',
    pluralLabel: 'Autoscaler (HPA)'
  },
  services: {
    category: 'network',
    short: 'svc',
    singular: 'Service',
    pluralLabel: 'Services'
  },
  ingresses: {
    category: 'network',
    short: 'ing',
    singular: 'Ingress',
    pluralLabel: 'Ingresses'
  },
  endpoints: {
    category: 'network',
    short: 'ep',
    singular: 'Endpoints',
    pluralLabel: 'Endpoints'
  },
  endpointslices: {
    category: 'network',
    short: 'eps',
    singular: 'EndpointSlice',
    pluralLabel: 'EndpointSlices'
  },
  networkpolicies: {
    category: 'network',
    short: 'netpol',
    singular: 'NetworkPolicy',
    pluralLabel: 'NetworkPolicies'
  },
  gateways: {
    category: 'network',
    short: 'gw',
    singular: 'Gateway',
    pluralLabel: 'Gateways'
  },
  httproutes: {
    category: 'network',
    short: 'route',
    singular: 'HTTPRoute',
    pluralLabel: 'HTTPRoutes'
  },
  configmaps: {
    category: 'config',
    short: 'cm',
    singular: 'ConfigMap',
    pluralLabel: 'ConfigMaps'
  },
  secrets: {
    category: 'config',
    short: 'sec',
    singular: 'Secret',
    pluralLabel: 'Secrets'
  },
  resourcequotas: {
    category: 'config',
    short: 'quota',
    singular: 'ResourceQuota',
    pluralLabel: 'ResourceQuotas'
  },
  limitranges: {
    category: 'config',
    short: 'limits',
    singular: 'LimitRange',
    pluralLabel: 'LimitRanges'
  },
  poddisruptionbudgets: {
    category: 'config',
    short: 'pdb',
    singular: 'PDB',
    pluralLabel: 'DisruptionBudgets'
  },
  persistentvolumeclaims: {
    category: 'storage',
    short: 'pvc',
    singular: 'PVC',
    pluralLabel: 'VolumeClaims (PVC)'
  },
  persistentvolumes: {
    category: 'storage',
    short: 'pv',
    singular: 'PersistentVolume',
    pluralLabel: 'PersistentVolumes'
  },
  storageclasses: {
    category: 'storage',
    short: 'sc',
    singular: 'StorageClass',
    pluralLabel: 'StorageClasses'
  },
  volumeattachments: {
    category: 'storage',
    short: 'volatt',
    singular: 'VolumeAttachment',
    pluralLabel: 'VolumeAttachments'
  },
  nodes: {
    category: 'nodes',
    short: 'no',
    singular: 'Node',
    pluralLabel: 'Nodes'
  },
  namespaces: {
    category: 'config',
    short: 'ns',
    singular: 'Namespace',
    pluralLabel: 'Namespaces'
  },
  serviceaccounts: {
    category: 'rbac',
    short: 'sa',
    singular: 'ServiceAccount',
    pluralLabel: 'ServiceAccounts'
  },
  roles: {
    category: 'rbac',
    short: 'role',
    singular: 'Role',
    pluralLabel: 'Roles'
  },
  rolebindings: {
    category: 'rbac',
    short: 'rb',
    singular: 'RoleBinding',
    pluralLabel: 'RoleBindings'
  },
  clusterroles: {
    category: 'rbac',
    short: 'crole',
    singular: 'ClusterRole',
    pluralLabel: 'ClusterRoles'
  },
  clusterrolebindings: {
    category: 'rbac',
    short: 'crb',
    singular: 'ClusterRoleBinding',
    pluralLabel: 'ClusterRoleBindings'
  },
  events: {
    category: 'timeline',
    short: 'ev',
    singular: 'Event',
    pluralLabel: 'Events'
  },
  customresourcedefinitions: {
    category: 'crd',
    short: 'crd',
    singular: 'CRD',
    pluralLabel: 'Custom Resources'
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

function humanizeResourcePlural(slug: string): { short: string; label: string } {
  const clean = slug.replace(/[^a-zA-Z0-9-]/g, '')
  if (!clean) return { short: 'res', label: 'Ressourcen' }
  const label = clean.charAt(0).toUpperCase() + clean.slice(1)
  const short = clean.length <= 6 ? clean.toLowerCase() : clean.slice(0, 5).toLowerCase()
  return { short, label }
}

/**
 * Normalizes a full or relative Radar URL into a canonical, port-independent route path
 * (e.g. `/resources/deployments?namespaces=payments`).
 */
export function normalizeRadarRoutePath(rawUrlOrPath: string): string {
  const trimmed = (rawUrlOrPath || '').trim()
  if (!trimmed) return '/'

  try {
    const parsed = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed)
      : new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, 'http://radar.local')
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
}

/**
 * Deterministically parses a Radar SPA route into official Kubernetes coordinates
 * (Cluster surface, Kind shortname, Resource target, and Namespaces) with zero API calls.
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
      kindShort: 'cluster',
      kindName: 'Übersicht',
      namespaces: queryNamespaces
    }
  }

  // 2. Topology (/topology?mode=traffic&namespaces=...)
  if (root === 'topology') {
    const mode = parsed.searchParams.get('mode')
    return {
      routePath,
      category: 'topology',
      kindShort: 'topo',
      kindName: mode === 'traffic' ? 'Traffic-Topologie' : 'Topologie',
      namespaces: queryNamespaces
    }
  }

  // 3. Fullscreen Workload route: /workload/:kind/:namespace/:name
  if (root === 'workload') {
    const kindSlug = (segments[1] || '').toLowerCase()
    const nsSegment = segments[2] && segments[2] !== '_' ? segments[2] : undefined
    const targetName = segments.slice(3).join('/') || undefined
    const spec = K8S_PLURAL_SPECS[kindSlug]
    const fallback = humanizeResourcePlural(kindSlug)
    const namespaces = nsSegment
      ? Array.from(new Set([nsSegment, ...queryNamespaces]))
      : queryNamespaces

    return {
      routePath,
      category: spec?.category ?? 'workloads',
      kindShort: spec?.short ?? fallback.short,
      kindName: spec ? spec.singular : fallback.label,
      targetName,
      namespaces
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
        kindShort: 'res',
        kindName: 'Ressourcen',
        namespaces
      }
    }

    const spec = K8S_PLURAL_SPECS[pluralSlug]
    if (spec) {
      return {
        routePath,
        category: spec.category,
        kindShort: spec.short,
        kindName: focused.name ? spec.singular : spec.pluralLabel,
        targetName: focused.name,
        namespaces
      }
    }

    const cleanPageTitle = pageTitle
      ?.replace(/\s*[·|-]\s*Radar$/i, '')
      .trim()
    const fallback = humanizeResourcePlural(pluralSlug)
    return {
      routePath,
      category: 'crd',
      kindShort: fallback.short,
      kindName: cleanPageTitle || fallback.label,
      targetName: focused.name,
      namespaces
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
      kindShort: 'helm',
      kindName: isCompare ? 'Helm-Vergleich' : 'Helm Releases',
      targetName: release.name,
      namespaces: release.namespace
        ? Array.from(new Set([release.namespace, ...queryNamespaces]))
        : queryNamespaces
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
      kindShort: 'gitops',
      kindName: 'GitOps',
      targetName: detailName,
      namespaces: detailNs
        ? Array.from(new Set([detailNs, ...queryNamespaces]))
        : queryNamespaces
    }
  }

  // 7. Applications (/applications?app=ns/name)
  if (root === 'applications') {
    const appTarget = parseResourceQueryTarget(parsed.searchParams.get('app'))
    return {
      routePath,
      category: 'applications',
      kindShort: 'app',
      kindName: 'Applikationen',
      targetName: appTarget.name,
      namespaces: appTarget.namespace
        ? Array.from(new Set([appTarget.namespace, ...queryNamespaces]))
        : queryNamespaces
    }
  }

  // 8. Issues / Warnings
  if (root === 'issues') {
    return {
      routePath,
      category: 'issues',
      kindShort: 'issues',
      kindName: 'Probleme & Warnungen',
      namespaces: queryNamespaces
    }
  }

  // 9. Event Timeline
  if (root === 'timeline') {
    return {
      routePath,
      category: 'timeline',
      kindShort: 'ev',
      kindName: 'Event-Timeline',
      namespaces: queryNamespaces
    }
  }

  // 10. Live Service Traffic
  if (root === 'traffic') {
    return {
      routePath,
      category: 'traffic',
      kindShort: 'traffic',
      kindName: 'Service-Traffic',
      namespaces: queryNamespaces
    }
  }

  // 11. Cost & Capacity
  if (root === 'cost' || root === 'capacity') {
    return {
      routePath,
      category: 'cost',
      kindShort: root === 'capacity' ? 'cap' : 'cost',
      kindName: root === 'capacity' ? 'Kapazität' : 'Kosten & Ressourcen',
      namespaces: queryNamespaces
    }
  }

  // 12. Cluster Checks / Audit / Upgrade readiness
  if (root === 'checks' || root === 'audit') {
    const isUpgrade = (segments[1] || '').toLowerCase() === 'upgrade'
    return {
      routePath,
      category: 'checks',
      kindShort: 'audit',
      kindName: isUpgrade ? 'Upgrade-Prüfung' : 'Cluster-Checks',
      namespaces: queryNamespaces
    }
  }

  // Fallback for workspace extensions (e.g. CloudNativePG / compare / investigations)
  const fallback = humanizeResourcePlural(root)
  return {
    routePath,
    category: 'crd',
    kindShort: fallback.short,
    kindName: fallback.label,
    namespaces: queryNamespaces
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
    kindShort: parsed.kindShort,
    kindName: parsed.kindName,
    targetName: parsed.targetName,
    namespaces: parsed.namespaces,
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
