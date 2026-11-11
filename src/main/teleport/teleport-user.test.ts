import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTshProfileUser, resolveTeleportUsername } from './teleport-user'
import { buildTshLoginArgs } from './tsh-session'

describe('readTshProfileUser', () => {
  it('returns the profile user that matches the proxy, not the local OS account', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsh-profile-'))
    writeFileSync(
      join(dir, 'teleport.example.test.yaml'),
      ['web_proxy_addr: teleport.example.test:443', 'user: ada@example.test', 'cluster: teleport.example.test', ''].join(
        '\n'
      )
    )
    writeFileSync(
      join(dir, 'other.example.yaml'),
      ['web_proxy_addr: other.example:443', 'user: other-user', ''].join('\n')
    )

    expect(readTshProfileUser('https://teleport.example.test:443', dir)).toBe('ada@example.test')
    expect(readTshProfileUser('teleport.example.test', dir)).toBe('ada@example.test')
  })

  it('does not guess when several profiles exist and no proxy was given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsh-profile-'))
    writeFileSync(join(dir, 'a.yaml'), 'web_proxy_addr: a.example:443\nuser: one\n')
    writeFileSync(join(dir, 'b.yaml'), 'web_proxy_addr: b.example:443\nuser: two\n')
    expect(readTshProfileUser(undefined, dir)).toBeUndefined()
  })
})

describe('resolveTeleportUsername', () => {
  it('prefers an explicit username over the saved profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsh-profile-'))
    writeFileSync(join(dir, 'teleport.yaml'), 'web_proxy_addr: teleport.example.test:443\nuser: ada@example.test\n')
    expect(
      resolveTeleportUsername({
        explicit: 'grace',
        proxyAddr: 'teleport.example.test:443',
        persistedUser: 'saved-user',
        tshHome: dir
      })
    ).toBe('grace')
  })

  it('uses the tsh profile user when nothing has been remembered yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsh-profile-'))
    writeFileSync(join(dir, 'teleport.yaml'), 'web_proxy_addr: teleport.example.test:443\nuser: ada@example.test\n')
    expect(
      resolveTeleportUsername({
        proxyAddr: 'teleport.example.test',
        envUser: 'env-user',
        tshHome: dir
      })
    ).toBe('ada@example.test')
  })

  it('keeps a corrected username instead of reverting to the old tsh profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsh-profile-'))
    writeFileSync(join(dir, 'teleport.yaml'), 'web_proxy_addr: teleport.example.test:443\nuser: ada@example.test\n')
    expect(
      resolveTeleportUsername({
        proxyAddr: 'teleport.example.test',
        persistedUser: 'grace',
        tshHome: dir
      })
    ).toBe('grace')
  })

  it('falls back to the persisted user when no profile matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsh-profile-'))
    expect(
      resolveTeleportUsername({
        proxyAddr: 'missing.example',
        persistedUser: 'saved-user',
        tshHome: dir
      })
    ).toBe('saved-user')
  })
})

describe('buildTshLoginArgs username', () => {
  it('passes the remembered Teleport username so tsh does not default to the OS account', () => {
    const args = buildTshLoginArgs({
      isTeleport: true,
      proxyAddr: 'teleport.example.test:443',
      username: 'ada@example.test'
    })
    expect(args).toContain('--user=ada@example.test')
  })
})
