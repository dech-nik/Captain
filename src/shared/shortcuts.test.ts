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
    expect(sanitizeShortcutAccelerator('Ctrl+p', 'CommandOrControl+,')).toBe(
      'CommandOrControl+P'
    )
    expect(sanitizeShortcutAccelerator('Cmd+,', 'CommandOrControl+P')).toBe(
      'CommandOrControl+,'
    )
    expect(sanitizeShortcutAccelerator('f2', 'CommandOrControl+P')).toBe('F2')
    expect(sanitizeShortcutAccelerator('p', 'CommandOrControl+P')).toBe('CommandOrControl+P')
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
      key: 'P',
      code: 'KeyP',
      control: true,
      meta: false,
      alt: false,
      shift: false
    }
    expect(matchesElectronInput(winInput, 'CommandOrControl+P', 'win32')).toBe(true)
    expect(matchesElectronInput(winInput, 'CommandOrControl+P', 'darwin')).toBe(false)

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

  it('matches Alt+1..5 palette quick-slot triggers', () => {
    expect(
      matchPaletteSlotInput({
        type: 'keyDown',
        key: '3',
        code: 'Digit3',
        alt: true,
        control: false,
        meta: false,
        shift: false
      })
    ).toBe(2)

    expect(
      matchPaletteSlotInput({
        type: 'keyDown',
        key: '6',
        code: 'Digit6',
        alt: true
      })
    ).toBeNull()
  })

  it('formats platform keycaps and flags Radar shortcut collisions', () => {
    expect(formatShortcutKeycaps('CommandOrControl+Shift+L', false)).toEqual([
      'Strg',
      'Umschalt',
      'L'
    ])
    expect(formatShortcutKeycaps('CommandOrControl+Shift+L', true)).toEqual(['⌘', '⇧', 'L'])

    expect(getRadarShortcutConflictWarning('CommandOrControl+K')).toBeTruthy()
    expect(getRadarShortcutConflictWarning(DEFAULT_SHORTCUT_BINDINGS.paletteMenu)).toBeNull()
    expect(normalizeShortcutBindings({}).openSettings).toBe('CommandOrControl+,')
  })
})
