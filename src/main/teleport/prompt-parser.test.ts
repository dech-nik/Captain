import { describe, expect, it } from 'vitest'
import { TshPromptParser } from './prompt-parser'
import { buildTshKubeLoginAllArgs, buildTshLoginArgs } from './tsh-session'

describe('TshPromptParser', () => {
  it('detects password prompt with ANSI codes stripped', () => {
    const parser = new TshPromptParser()
    const res = parser.feed('\u001b[32mEnter password for Teleport user user:\u001b[0m ')
    expect(res?.step).toBe('password')
    expect(res?.promptText).toContain('Enter password for Teleport user')
  })

  it('detects combined YubiKey + OTP MFA prompt so both touch and OTP input work in UI', () => {
    const parser = new TshPromptParser()

    const pinUpdate = parser.feed('Enter your security key PIN: ')
    expect(pinUpdate?.step).toBe('yubikey_pin')
    parser.clearAfterSubmit()

    const mfaUpdate = parser.feed('\r\nTap any security key or enter a code from a OTP device:\r\n')
    expect(mfaUpdate?.step).toBe('mfa_touch_or_otp')

    const mfaRegisteredUpdate = parser.feed(
      '\r\nTap any *registered* security key or enter a code from a *registered* OTP device:\r\n'
    )
    expect(mfaRegisteredUpdate?.step).toBe('mfa_touch_or_otp')
  })

  it('detects pure YubiKey touch prompt when OTP is not part of prompt', () => {
    const parser = new TshPromptParser()
    const res = parser.feed('Tap your security key to complete login\r\n')
    expect(res?.step).toBe('yubikey_touch')
  })

  it('detects real tsh v18 OTP token and OTP code prompts', () => {
    const parser = new TshPromptParser()
    expect(parser.feed('Enter your OTP token:\r\n')?.step).toBe('otp')
    parser.clearAfterSubmit()
    expect(parser.feed('Enter an OTP code from a device: ')?.step).toBe('otp')
  })

  it('does not let an earlier touch line shadow a subsequent OTP prompt', () => {
    const parser = new TshPromptParser()
    expect(parser.feed('Tap any security key\r\n')?.step).toBe('yubikey_touch')
    expect(parser.feed('Enter your OTP token:\r\n')?.step).toBe('otp')
  })

  it('captures invalid username or credentials before the next prompt', () => {
    const parser = new TshPromptParser()
    const res = parser.feed(
      'ERROR: invalid username or password, please try again\r\nEnter password for Teleport user ada@example.test: '
    )
    expect(res?.step).toBe('password')
    expect(res?.errorMessage?.toLowerCase()).toContain('invalid username')
  })

  it('captures error diagnostics when invalid password or OTP is entered', () => {
    const parser = new TshPromptParser()
    const res = parser.feed('ERROR: invalid password or second factor\r\nEnter password for Teleport user user: ')
    expect(res?.step).toBe('password')
    expect(res?.errorMessage).toContain('invalid password')
  })

  it('automatically flags forceTerminalOpen on unknown interactive prompt', () => {
    const parser = new TshPromptParser()
    const res = parser.feed('Select authentication connector [local/github]: ')
    expect(res?.step).toBe('unknown_prompt')
    expect(res?.forceTerminalOpen).toBe(true)
  })
})

describe('buildTshLoginArgs', () => {
  it('builds tsh login args with --browser=none and --kube-cluster when kubeCluster is present', () => {
    const args = buildTshLoginArgs({
      isTeleport: true,
      proxyAddr: 'example.test:443',
      teleportCluster: 'example',
      kubeCluster: 'example-cluster'
    })
    expect(args).toEqual([
      '--proxy=example.test:443',
      'login',
      '--browser=none',
      '--kube-cluster=example-cluster',
      'example'
    ])
  })

  it('builds standard tsh login args when only teleport proxy/cluster is present', () => {
    const args = buildTshLoginArgs(
      {
        isTeleport: true,
        proxyAddr: 'example.test:443',
        teleportCluster: 'example'
      },
      'user'
    )
    expect(args).toEqual([
      '--proxy=example.test:443',
      '--user=user',
      'login',
      '--browser=none',
      'example'
    ])
  })

  it('passes explicit --mfa-mode when configured in Captain preferences', () => {
    const args = buildTshLoginArgs(
      {
        isTeleport: true,
        proxyAddr: 'teleport.example.test:443'
      },
      'ada@example.test',
      'otp'
    )
    expect(args).toEqual([
      '--proxy=teleport.example.test:443',
      '--user=ada@example.test',
      '--mfa-mode=otp',
      'login',
      '--browser=none'
    ])
  })
})

describe('buildTshKubeLoginAllArgs', () => {
  it('asks tsh for every accessible kube cluster even when one cluster triggered the login', () => {
    expect(
      buildTshKubeLoginAllArgs({
        isTeleport: true,
        proxyAddr: 'teleport.example.test:443',
        teleportCluster: 'teleport.example.test',
        kubeCluster: 'only-one',
        username: 'ada@example.test'
      })
    ).toEqual([
      '--proxy=teleport.example.test:443',
      '--user=ada@example.test',
      'kube',
      'login',
      '--all',
      '--cluster=teleport.example.test'
    ])
  })
})
