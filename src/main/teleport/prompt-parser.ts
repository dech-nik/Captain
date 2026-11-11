import type { LoginStep } from '@shared/types'

export interface ParsedPromptUpdate {
  step: LoginStep
  promptText: string
  errorMessage?: string
  forceTerminalOpen?: boolean
}

// Comprehensive ANSI CSI / OSC / control sequence stripper
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '').replace(/\r/g, '')
}

/**
 * Stateful parser for `tsh login` PTY output streams.
 * Recognizes username, password, FIDO2/YubiKey PIN, combined YubiKey-or-OTP MFA,
 * pure YubiKey hardware touch, and pure OTP/TOTP prompts (matched against real tsh v18 strings).
 */
export class TshPromptParser {
  private rollingBuffer = ''
  private lastError: string | undefined

  public reset(): void {
    this.rollingBuffer = ''
    this.lastError = undefined
  }

  /**
   * Clears buffered prompt lines after the user submits an answer so earlier prompts
   * (like a prior password or touch line) never shadow the next prompt.
   */
  public clearAfterSubmit(): void {
    this.rollingBuffer = ''
    this.lastError = undefined
  }

  public feed(rawChunk: string): ParsedPromptUpdate | null {
    const clean = stripAnsi(rawChunk)
    if (!clean) return null

    this.rollingBuffer = (this.rollingBuffer + clean).slice(-2048)

    const lines = this.rollingBuffer
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    if (lines.length === 0) return null

    // Capture recent error messages emitted by tsh before re-prompting or exiting
    for (const line of lines.slice(-6)) {
      const lower = line.toLowerCase()
      if (
        lower.startsWith('error:') ||
        lower.includes('invalid password') ||
        lower.includes('invalid username') ||
        lower.includes('invalid credential') ||
        lower.includes('incorrect credential') ||
        lower.includes('invalid otp') ||
        lower.includes('invalid token') ||
        lower.includes('invalid pin') ||
        lower.includes('incorrect pin') ||
        lower.includes('access denied') ||
        lower.includes('failed to authenticate') ||
        lower.includes('authentication failed')
      ) {
        this.lastError = line.replace(/^ERROR:\s*/i, '')
      }
    }

    const tail = lines.slice(-3).join(' \n ')
    const lowerTail = tail.toLowerCase()
    const latestLine = lines[lines.length - 1]
    const lowerLatest = latestLine.toLowerCase()

    // Join last 2 lines only for detecting long prompts that PTY width (92 cols) may have soft-wrapped
    const recentTwo = lines.slice(-2).join(' ')
    const lowerRecentTwo = recentTwo.toLowerCase()

    // Successful profile summary output (`> Profile URL: ... Logged in as: ...`)
    if (lowerTail.includes('profile url:') && lowerTail.includes('logged in as:')) {
      return {
        step: 'success',
        promptText: 'Erfolgreich angemeldet.'
      }
    }

    // Do not misclassify an `ERROR: ...` line itself as an input prompt
    if (!lowerLatest.startsWith('error:')) {
      // 1. Combined Hardware Key + OTP prompt from tsh:
      //    e.g. `Tap any security key or enter a code from a OTP device:`
      //    or   `Tap any *registered* security key or enter a code from a *registered* OTP device:`
      if (/tap (any|your) .*security key\s+or\s+enter/i.test(lowerRecentTwo)) {
        return {
          step: 'mfa_touch_or_otp',
          promptText: recentTwo,
          errorMessage: this.lastError
        }
      }

      // 2. Pure OTP / TOTP / Authenticator prompt from tsh:
      //    e.g. `Enter your OTP token:`, `Enter an OTP code from a device:`
      if (
        lowerLatest.includes('otp token') ||
        lowerLatest.includes('otp code') ||
        lowerLatest.includes('otp device') ||
        lowerLatest.includes('enter your otp') ||
        lowerLatest.includes('enter an otp') ||
        lowerLatest.includes('totp') ||
        lowerLatest.includes('two-factor') ||
        lowerLatest.includes('2fa') ||
        lowerLatest.includes('authenticator') ||
        lowerLatest.includes('verification code') ||
        lowerLatest.includes('one-time') ||
        /\botp\b/.test(lowerLatest)
      ) {
        return {
          step: 'otp',
          promptText: latestLine,
          errorMessage: this.lastError
        }
      }

      // 3. Security key / YubiKey PIN prompt (FIDO2 / PIV PIN):
      //    e.g. `Enter your security key PIN:`, `Enter your YubiKey PIV PIN:`
      if (
        lowerLatest.includes('security key pin') ||
        lowerLatest.includes('yubikey piv pin') ||
        lowerLatest.includes('piv pin') ||
        lowerLatest.includes('enter your pin') ||
        (/\bpin\b/.test(lowerLatest) && (lowerLatest.includes('enter ') || lowerLatest.endsWith(':')))
      ) {
        return {
          step: 'yubikey_pin',
          promptText: latestLine,
          errorMessage: this.lastError
        }
      }

      // 4. Password prompt (`Enter password for Teleport user <user>:`)
      if (
        lowerLatest.includes('enter password') ||
        (lowerLatest.includes('password') && lowerLatest.endsWith(':'))
      ) {
        return {
          step: 'password',
          promptText: latestLine,
          errorMessage: this.lastError
        }
      }

      // 5. Username prompt when no Teleport user is known yet
      if (
        lowerLatest === 'login:' ||
        lowerLatest.includes('enter username') ||
        lowerLatest.includes('teleport user:') ||
        (lowerLatest.startsWith('user') && lowerLatest.endsWith(':'))
      ) {
        return {
          step: 'username',
          promptText: latestLine,
          errorMessage: this.lastError
        }
      }

      // 6. Pure Hardware key touch / tap prompt (YubiKey FIDO2 / U2F without OTP option):
      //    e.g. `Tap any security key`, `Tap your security key`, `Tap your YubiKey`, `Touch you(r) security key`
      if (
        /tap (any|your) .*security key/i.test(lowerLatest) ||
        lowerLatest.includes('tap your yubikey') ||
        /touch you(r)? .*security key/i.test(lowerLatest) ||
        lowerLatest.includes('tap security key') ||
        lowerLatest.includes('press the button on your security key')
      ) {
        return {
          step: 'yubikey_touch',
          promptText: latestLine,
          errorMessage: this.lastError
        }
      }

      // 7. SSO / Browser-less fallback or unknown interactive prompt ending with ':' or '?'
      if (
        lowerTail.includes('browser=none') ||
        lowerTail.includes('open the url below') ||
        ((latestLine.endsWith(':') || latestLine.endsWith('?')) &&
          !lowerLatest.includes('profile url:'))
      ) {
        return {
          step: 'unknown_prompt',
          promptText: latestLine,
          errorMessage: this.lastError,
          forceTerminalOpen: true
        }
      }
    }

    if (this.lastError) {
      return {
        step: 'error',
        promptText: latestLine,
        errorMessage: this.lastError
      }
    }

    return null
  }
}
