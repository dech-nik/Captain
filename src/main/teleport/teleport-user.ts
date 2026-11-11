import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ResolveTeleportUserInput {
  explicit?: string
  proxyAddr?: string
  persistedUser?: string
  statusUser?: string
  envUser?: string
  tshHome?: string
}

/**
 * `tsh login` without `--user` authenticates as the local OS account.
 * Teleport usernames often differ (for example an email address), so a later
 * password prompt is checked against the wrong account and then asks for the
 * username again. Prefer an explicit entry, then the on-disk tsh profile that
 * survives `tsh logout`, then the last user this app stored.
 */
export function resolveTeleportUsername(input: ResolveTeleportUserInput): string | undefined {
  const explicit = cleanUser(input.explicit)
  if (explicit) return explicit

  // A username this app already stored wins over the tsh profile, so a correction
  // in the login form is not overwritten by the previous profile on the next attempt.
  const persisted = cleanUser(input.persistedUser)
  if (persisted) return persisted

  const fromProfile = readTshProfileUser(input.proxyAddr, input.tshHome)
  if (fromProfile) return fromProfile

  const statusUser = cleanUser(input.statusUser)
  if (statusUser) return statusUser

  return cleanUser(input.envUser)
}

export function readTshProfileUser(proxyAddr?: string, tshHome = join(homedir(), '.tsh')): string | undefined {
  if (!existsSync(tshHome)) return undefined

  let names: string[] = []
  try {
    names = readdirSync(tshHome)
  } catch {
    return undefined
  }

  const wantedHost = proxyHost(proxyAddr)
  const matches: string[] = []
  const anyUsers: string[] = []

  for (const name of names) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    let text = ''
    try {
      text = readFileSync(join(tshHome, name), 'utf8')
    } catch {
      continue
    }
    const user = profileField(text, 'user')
    if (!user) continue
    anyUsers.push(user)
    const profileProxy = profileField(text, 'web_proxy_addr') || profileField(text, 'ssh_proxy_addr')
    if (wantedHost && proxyHost(profileProxy) === wantedHost) {
      matches.push(user)
    }
  }

  if (wantedHost) return uniqueUser(matches)
  return uniqueUser(anyUsers)
}

function uniqueUser(users: string[]): string | undefined {
  const distinct = [...new Set(users)]
  return distinct.length === 1 ? distinct[0] : undefined
}

function profileField(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) return undefined
  return cleanUser(match[1].replace(/#.*$/, ''))
}

export function proxyHost(addr?: string): string | undefined {
  if (!addr) return undefined
  const host = addr
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase()
  return host || undefined
}

function cleanUser(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '')
  return trimmed || undefined
}
