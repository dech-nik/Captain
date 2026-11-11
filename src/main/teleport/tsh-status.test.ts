import { describe, expect, it } from 'vitest'
import { snapshotFromTshStatus } from './tsh-status'

describe('snapshotFromTshStatus', () => {
  it('treats tsh v18 profile_url as a logged-in session', () => {
    const snapshot = snapshotFromTshStatus(
      {
        active: {
          profile_url: 'https://teleport.example.test:443',
          username: 'ada@example.test',
          cluster: 'teleport.example.test',
          kubernetes_cluster: 'prod-1'
        }
      },
      true
    )
    expect(snapshot.loggedIn).toBe(true)
    expect(snapshot.proxyAddr).toBe('teleport.example.test:443')
    expect(snapshot.username).toBe('ada@example.test')
    expect(snapshot.teleportCluster).toBe('teleport.example.test')
    expect(snapshot.hasKubeClusters).toBe(true)
  })

  it('does not mark an expired profile JSON as logged in', () => {
    const snapshot = snapshotFromTshStatus(
      {
        active: {
          profile_url: 'https://teleport.example.test:443',
          username: 'ada@example.test',
          cluster: 'teleport.example.test'
        }
      },
      false
    )
    expect(snapshot.loggedIn).toBe(false)
    expect(snapshot.proxyAddr).toBe('teleport.example.test:443')
    expect(snapshot.username).toBe('ada@example.test')
  })
})
