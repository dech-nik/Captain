import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'

interface EmbeddedTerminalProps {
  visible: boolean
}

/**
 * Collapsible fallback xterm.js console for direct PTY interaction.
 * Computes column/row dimensions natively via ResizeObserver without requiring @xterm/addon-fit.
 */
export const EmbeddedTerminal: React.FC<EmbeddedTerminalProps> = ({ visible }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)

  const fitTerminalToContainer = (): void => {
    const el = containerRef.current
    const term = termRef.current
    if (!el || !term) return
    const rect = el.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) return

    const cols = Math.max(40, Math.floor((rect.width - 16) / 7.3))
    const rows = Math.max(6, Math.floor((rect.height - 12) / 17.5))
    if (cols !== term.cols || rows !== term.rows) {
      try {
        term.resize(cols, rows)
        window.launcherApi.resizePty(cols, rows)
      } catch {
        // Ignore transient resize errors
      }
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 12,
      lineHeight: 1.35,
      fontFamily:
        "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      theme: {
        background: '#0F172A',
        foreground: '#E2E8F0',
        cursor: '#10B981',
        selectionBackground: 'rgba(16, 185, 129, 0.28)',
        black: '#0F172A',
        red: '#F87171',
        green: '#4ADE80',
        yellow: '#FBBF24',
        blue: '#60A5FA',
        magenta: '#C084FC',
        cyan: '#38BDF8',
        white: '#F8FAFC'
      },
      convertEol: true
    })

    term.open(el)
    termRef.current = term

    const disposeInput = term.onData((data) => {
      window.launcherApi.writeRawPty(data)
    })

    const unsubscribePty = window.launcherApi.onPtyData((chunk) => {
      term.write(chunk)
    })

    const observer = new ResizeObserver(() => {
      fitTerminalToContainer()
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      unsubscribePty()
      disposeInput.dispose()
      term.dispose()
      termRef.current = null
    }
  }, [])

  useEffect(() => {
    if (visible && termRef.current) {
      const timer = setTimeout(() => {
        fitTerminalToContainer()
        termRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [visible])

  return (
    <div className={visible ? 'terminal-shell' : 'terminal-shell-hidden'}>
      <div className="terminal-topbar">
        <div className="terminal-topbar-left">
          <span className="terminal-live-dot" />
          <span className="terminal-topbar-title">tsh · Interaktive Sitzung</span>
        </div>
        <span className="terminal-topbar-hint">Direkteingabe aktiv</span>
      </div>
      <div ref={containerRef} className="terminal-viewport" />
    </div>
  )
}
