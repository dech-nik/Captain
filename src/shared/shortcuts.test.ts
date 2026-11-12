import { describe, expect, it } from 'vitest'
import {
  acceleratorFromKeyboardEvent,
  DEFAULT_SHORTCUT_BINDINGS,
  formatShortcutKeycaps,
  getRadarShortcutConflictWarning,
  matchesElectronInput,
  matchPaletteSlotInput,
  normalizeShortcutBindings,
  sanitizeShortcutAccelerator
} from './shortcuts'

describe('Captain keyboard shortcut normalization & matching', () => {
  it('normalizes cross-platform accelerators and rejects bare single-character keys', () => {
    expect(sanitizeShortcutAccelerator('Ctrl+Shift+k', 'CommandOrControl+P')).toBe(
      'CommandOrControl+Shift+K'
    )
    expect(sanitizeShortcutAccelerator('Cmd+,', 'CommandOrControl+P')).toBe(
      'CommandOrControl+,'
    )
    expect(sanitizeShortcutAccelerator('f2', 'CommandOrControl+P')).toBe('F2')
    // Single letter without modifiers must fall back so typing in Radar is never hijacked
    expect(sanitizeShortcutAccelerator('k', 'CommandOrControl+Shift+K')).toBe(
      'CommandOrControl+Shift+K'
    )
  })

  it('records valid accelerators from browser KeyboardEvents', () => {
    expect(
      acceleratorFromKeyboardEvent({
        key: 'p',
        code: 'KeyP',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    ).toBe('CommandOrControl+P')

    expect(
      acceleratorFromKeyboardEvent({
        key: '<',
        code: 'Comma',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false
      })
    ).toBe('CommandOrControl+,')

    // Holding only Control should return null while waiting for the main key
    expect(
      acceleratorFromKeyboardEvent({
        key: 'Control',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    ).toBeNull()
  })

  it('matches Electron before-input-event payloads accurately per OS', () => {
    const winInput = {
      type: 'keyDown',
      key: 'K',
      code: 'KeyK',
      control: true,
      meta: false,
      alt: false,
      shift: true
    }
    expect(matchesElectronInput(winInput, 'CommandOrControl+Shift+K', 'win32')).toBe(true)
    expect(matchesElectronInput(winInput, 'CommandOrControl+Shift+K', 'darwin')).toBe(false)

    const macInput = {
      type: 'keyDown',
      key: ',',
      code: 'Comma',
      control: false,
      meta: true,
      alt: false,
      shift: false
    }
    expect(matchesElectronInput(macInput, 'CommandOrControl+,', 'darwin')).toBe(true)
  })

  it('matches Alt+1..N palette quick-slot triggers', () => {
    expect(
      matchPaletteSlotInput(
        {
          type: 'keyDown',
          key: '3',
          code: 'Digit3',
          alt: true,
          control: false,
          meta: false,
          shift: false
        },
        5
      )
    ).toBe(2)

    expect(
      matchPaletteSlotInput(
        {
          type: 'keyDown',
          key: '7',
          code: 'Digit7',
          alt: true
        },
        5
      )
    ).toBeNull()
  })

  it('formats platform keycaps and flags Radar shortcut collisions', () => {
    expect(formatShortcutKeycaps('CommandOrControl+Shift+K', false)).toEqual([
      'Strg',
      'Umschalt',
      'K'
    ])
    expect(formatShortcutKeycaps('CommandOrControl+Shift+K', true)).toEqual(['⌘', '⇧', 'K'])

    expect(getRadarShortcutConflictWarning('CommandOrControl+K')).toBeTruthy()
    expect(getRadarShortcutConflictWarning(DEFAULT_SHORTCUT_BINDINGS.quickSwitcher)).toBeNull()
    expect(normalizeShortcutBindings({}).openSettings).toBe('CommandOrControl+,')
  })
})
