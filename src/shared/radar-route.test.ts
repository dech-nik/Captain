import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceViewRef,
  getViewPrimaryLabel,
  isSameWorkspaceDestination,
  normalizeRadarRoutePath,
  parseRadarRoute
} from './radar-route'
import type { ContextSummary } from './types'

const SAMPLE_CONTEXTS: ContextSummary[] = [
  {
    name: 'teleport.example.com-prod-eu',
    cluster: 'teleport.example.com',
    namespace: 'default',
    teleport: {
      isTeleport: true,
      proxyAddr: 'teleport.example.com:443',
      teleportCluster: 'teleport.example.com',
      kubeCluster: 'prod-eu'
    }
  },
  {
    name: 'kind-local-dev',
    cluster: 'kind-local-dev',
    teleport: {
      isTeleport: false
    }
  }
]

describe('radar-route parser & view coordinate builder', () => {
  it('strips ephemeral loopback origins so saved routes remain portable across restarts', () => {
    expect(
      normalizeRadarRoutePath('http://127.0.0.1:54129/resources/deployments/?namespaces=payments')
    ).toBe('/resources/deployments?namespaces=payments')
    expect(normalizeRadarRoutePath('')).toBe('/')
  })

  it('parses overview and topology routes with official shortnames', () => {
    const home = parseRadarRoute('/')
    expect(home.category).toBe('overview')
    expect(home.kindShort).toBe('cluster')
    expect(home.kindName).toBe('Übersicht')
    expect(home.namespaces).toEqual([])

    const topo = parseRadarRoute('/topology?namespaces=payments,checkout&mode=traffic')
    expect(topo.category).toBe('topology')
    expect(topo.kindShort).toBe('topo')
    expect(topo.kindName).toBe('Traffic-Topologie')
    expect(topo.namespaces).toEqual(['payments', 'checkout'])
  })

  it('parses resource list and focused resource drawer routes into official K8s tokens', () => {
    const deployList = parseRadarRoute('/resources/deployments?namespaces=payments')
    expect(deployList.category).toBe('workloads')
    expect(deployList.kindShort).toBe('deploy')
    expect(deployList.kindName).toBe('Deployments')
    expect(deployList.targetName).toBeUndefined()
    expect(deployList.namespaces).toEqual(['payments'])

    const podDetail = parseRadarRoute(
      '/resources/pods?resource=payments/checkout-7f9b8c&namespaces=payments'
    )
    expect(podDetail.category).toBe('pods')
    expect(podDetail.kindShort).toBe('po')
    expect(podDetail.kindName).toBe('Pod')
    expect(podDetail.targetName).toBe('checkout-7f9b8c')
    expect(podDetail.namespaces).toEqual(['payments'])
  })

  it('parses fullscreen workload routes for both namespaced and cluster-scoped kinds', () => {
    const workload = parseRadarRoute('/workload/deployments/payments/checkout-api?tab=logs')
    expect(workload.category).toBe('workloads')
    expect(workload.kindShort).toBe('deploy')
    expect(workload.kindName).toBe('Deployment')
    expect(workload.targetName).toBe('checkout-api')
    expect(workload.namespaces).toEqual(['payments'])

    const nodeWorkload = parseRadarRoute('/workload/nodes/_/worker-node-01')
    expect(nodeWorkload.category).toBe('nodes')
    expect(nodeWorkload.kindShort).toBe('no')
    expect(nodeWorkload.kindName).toBe('Node')
    expect(nodeWorkload.targetName).toBe('worker-node-01')
    expect(nodeWorkload.namespaces).toEqual([])
  })

  it('parses helm, gitops, issues, timeline, and custom resource routes', () => {
    const helm = parseRadarRoute('/helm?release=monitoring/kube-prometheus')
    expect(helm.category).toBe('helm')
    expect(helm.kindShort).toBe('helm')
    expect(helm.targetName).toBe('kube-prometheus')
    expect(helm.namespaces).toEqual(['monitoring'])

    const gitops = parseRadarRoute('/gitops/detail/applications/argocd/billing-stack')
    expect(gitops.category).toBe('gitops')
    expect(gitops.kindShort).toBe('gitops')
    expect(gitops.targetName).toBe('billing-stack')
    expect(gitops.namespaces).toEqual(['argocd'])

    const crd = parseRadarRoute('/resources/certificates?apiGroup=cert-manager.io', 'Certificates · Radar')
    expect(crd.category).toBe('crd')
    expect(crd.kindName).toBe('Certificates')
  })

  it('builds WorkspaceViewRef with Teleport cluster display names and compares destinations', () => {
    const view = buildWorkspaceViewRef({
      id: 'v1',
      context: 'teleport.example.com-prod-eu',
      contexts: SAMPLE_CONTEXTS,
      rawUrlOrPath: 'http://127.0.0.1:61234/resources/services?namespaces=edge'
    })

    expect(view.clusterLabel).toBe('prod-eu')
    expect(view.isTeleport).toBe(true)
    expect(view.kindShort).toBe('svc')
    expect(getViewPrimaryLabel(view)).toBe('Services')

    expect(
      isSameWorkspaceDestination(view, {
        context: 'teleport.example.com-prod-eu',
        routePath: '/resources/services?namespaces=edge'
      })
    ).toBe(true)

    expect(
      isSameWorkspaceDestination(view, {
        context: 'kind-local-dev',
        routePath: '/resources/services?namespaces=edge'
      })
    ).toBe(false)
  })
})
