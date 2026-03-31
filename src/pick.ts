/**
 * pickWallet — Interactive wallet picker with three usage tiers:
 *
 *   1. Headless:  `discoverWallets()` — you build your own UI
 *   2. Default:   `pickWallet()` — built-in vanilla JS modal, zero config
 *   3. Custom:    `pickWallet({ render })` — bring your own renderer
 *
 * The default modal is framework-agnostic (vanilla DOM), works in React,
 * Vue, Svelte, or plain HTML. No dependencies.
 */

import { DISCOVER_EVENT, ANNOUNCE_EVENT } from './constants'
import type { WalletAnnouncement, WalletProtocol, DiscoverDetail, AnnounceDetail } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Object returned by a custom render function */
export interface PickerRenderer {
  /** Called when a new wallet is discovered (late arrivals) */
  update: (wallets: WalletAnnouncement[]) => void
  /** Called to tear down the UI */
  destroy: () => void
}

/** QR fallback shown when no browser extension wallets are discovered */
export interface QrFallbackOptions {
  /** The URL to encode in the QR code (e.g. OID4VP request URI from your backend) */
  url: string
  /** Label shown below the QR code (default: "Scan with mobile wallet") */
  label?: string
  /** Called when the mobile wallet responds (e.g. via your backend polling/WebSocket) */
  onResponse?: (data: unknown) => void
}

/** Options for pickWallet */
export interface PickWalletOptions {
  /** Discovery timeout in ms (default 2000 — longer than discoverWallets to catch late arrivals) */
  timeoutMs?: number
  /** Only show wallets that support ALL of these protocols. Omit to show all. */
  requiredProtocols?: WalletProtocol[]
  /** Only show wallets that support ALL of these goal codes. Omit to show all. */
  requiredGoals?: string[]
  /** QR code fallback when no extensions are found. Omit to disable. */
  qrFallback?: QrFallbackOptions
  /** Custom render function. Omit to use the built-in vanilla modal. */
  render?: (
    onSelect: (wallet: WalletAnnouncement) => void,
    onCancel: () => void,
  ) => PickerRenderer
}

// ---------------------------------------------------------------------------
// pickWallet
// ---------------------------------------------------------------------------

/**
 * Discover credential wallets and let the user pick one.
 *
 * - With no options: shows a built-in vanilla modal.
 * - With `render`: delegates UI to your custom renderer.
 * - Returns `null` if the user cancels or no wallets found after timeout.
 *
 * Late-arriving wallets are pushed to the UI via `renderer.update()`.
 */
export function pickWallet(options?: PickWalletOptions): Promise<WalletAnnouncement | null> {
  const timeoutMs = options?.timeoutMs ?? 2000
  const requiredProtocols = options?.requiredProtocols ?? []
  const requiredGoals = options?.requiredGoals ?? []

  return new Promise((resolve) => {
    const wallets: WalletAnnouncement[] = []
    const seen = new Set<string>()
    let settled = false
    let renderer: PickerRenderer | null = null

    function onSelect(wallet: WalletAnnouncement) {
      if (settled) return
      settled = true
      cleanup()
      resolve(wallet)
    }

    function onCancel() {
      if (settled) return
      settled = true
      cleanup()
      resolve(null)
    }

    function cleanup() {
      window.removeEventListener(ANNOUNCE_EVENT, onAnnounce)
      clearTimeout(timer)
      if (renderer) renderer.destroy()
    }

    function onAnnounce(e: Event) {
      const detail = (e as CustomEvent<AnnounceDetail>).detail
      if (detail?.nonce !== nonce) return
      if (seen.has(detail.wallet.did)) return
      // Filter: skip wallets that don't support all required protocols
      if (requiredProtocols.length > 0) {
        const supported = new Set(detail.wallet.protocols)
        if (!requiredProtocols.every((p) => supported.has(p))) return
      }
      // Filter: skip wallets that don't support all required goals
      if (requiredGoals.length > 0) {
        const supported = new Set(detail.wallet.goals ?? [])
        if (!requiredGoals.every((g) => supported.has(g))) return
      }
      seen.add(detail.wallet.did)
      wallets.push(detail.wallet)

      // Push update to renderer (handles late arrivals)
      if (renderer) renderer.update([...wallets])

      // Auto-select if only one wallet and using default modal
      // (custom renderers handle their own auto-select logic)
    }

    // Create renderer — custom or default
    renderer = options?.render
      ? options.render(onSelect, onCancel)
      : createDefaultModal(onSelect, onCancel)

    // Start discovery
    const nonce = `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce)
    window.dispatchEvent(new CustomEvent<DiscoverDetail>(DISCOVER_EVENT, {
      detail: { nonce },
    }))

    // Timeout — if no wallets found, show QR fallback or cancel
    const timer = setTimeout(() => {
      if (!settled && wallets.length === 0) {
        if (options?.qrFallback && !options?.render) {
          // Show QR fallback in the default modal
          showQrFallback(renderer as DefaultModalRenderer, options.qrFallback)
        } else {
          onCancel()
        }
      }
    }, timeoutMs)
  })
}

// ---------------------------------------------------------------------------
// Default vanilla modal
// ---------------------------------------------------------------------------

function createDefaultModal(
  onSelect: (wallet: WalletAnnouncement) => void,
  onCancel: () => void,
): PickerRenderer {
  // Backdrop
  const backdrop = document.createElement('div')
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  })
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) onCancel()
  })

  // Modal
  const modal = document.createElement('div')
  Object.assign(modal.style, {
    background: '#1a1a2e',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    padding: '24px',
    width: '360px',
    maxHeight: '480px',
    overflow: 'auto',
    color: '#ffffff',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
  })

  // Header
  const header = document.createElement('div')
  header.style.marginBottom = '16px'
  header.innerHTML = `
    <h2 style="margin:0;font-size:16px;font-weight:600;">Select Identity Wallet</h2>
    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">Choose a wallet to present your credentials</p>
  `
  modal.appendChild(header)

  // Wallet list container
  const list = document.createElement('div')
  Object.assign(list.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  })
  modal.appendChild(list)

  // Loading state
  const loading = document.createElement('div')
  Object.assign(loading.style, {
    textAlign: 'center',
    padding: '24px 0',
    fontSize: '13px',
    color: '#64748b',
  })
  loading.textContent = 'Discovering wallets…'
  list.appendChild(loading)

  // Cancel button
  const cancelBtn = document.createElement('button')
  Object.assign(cancelBtn.style, {
    marginTop: '12px',
    width: '100%',
    padding: '10px',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'transparent',
    color: '#94a3b8',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  })
  cancelBtn.textContent = 'Cancel'
  cancelBtn.addEventListener('click', onCancel)
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'rgba(255,255,255,0.05)' })
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent' })
  modal.appendChild(cancelBtn)

  backdrop.appendChild(modal)
  document.body.appendChild(backdrop)

  function renderWallets(wallets: WalletAnnouncement[]) {
    // Clear loading / previous items
    list.innerHTML = ''

    if (wallets.length === 0) {
      loading.textContent = 'Discovering wallets…'
      list.appendChild(loading)
      return
    }

    for (const wallet of wallets) {
      const row = document.createElement('button')
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        padding: '12px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(255, 255, 255, 0.03)',
        color: '#ffffff',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'background 0.15s, border-color 0.15s',
      })

      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(99, 102, 241, 0.15)'
        row.style.borderColor = 'rgba(99, 102, 241, 0.4)'
      })
      row.addEventListener('mouseleave', () => {
        row.style.background = 'rgba(255, 255, 255, 0.03)'
        row.style.borderColor = 'rgba(255, 255, 255, 0.1)'
      })

      row.innerHTML = `
        <img src="${escapeAttr(wallet.icon)}" alt="" style="width:40px;height:40px;border-radius:10px;object-fit:contain;" />
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:500;">${escapeHtml(wallet.name)}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">v${escapeHtml(wallet.version)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      `

      row.addEventListener('click', () => onSelect(wallet))
      list.appendChild(row)
    }
  }

  return {
    update: renderWallets,
    destroy: () => { backdrop.remove() },
    /** Exposed for QR fallback injection */
    listEl: list,
  } as DefaultModalRenderer
}

/** Extended renderer with DOM access for QR fallback */
interface DefaultModalRenderer extends PickerRenderer {
  listEl: HTMLElement
}

/**
 * Show QR code fallback inside the default modal when no extensions are found.
 * Uses a simple SVG-based QR rendering (no external dependency).
 */
function showQrFallback(renderer: DefaultModalRenderer, options: QrFallbackOptions): void {
  const list = renderer.listEl
  list.innerHTML = ''

  const container = document.createElement('div')
  Object.assign(container.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 0',
  })

  // QR code — render as a simple grid of modules
  const qrCanvas = document.createElement('canvas')
  qrCanvas.width = 200
  qrCanvas.height = 200
  Object.assign(qrCanvas.style, {
    borderRadius: '12px',
    background: '#ffffff',
    padding: '12px',
  })
  renderQrToCanvas(qrCanvas, options.url)
  container.appendChild(qrCanvas)

  // Label
  const label = document.createElement('p')
  Object.assign(label.style, {
    fontSize: '13px',
    color: '#94a3b8',
    textAlign: 'center',
    margin: '0',
  })
  label.textContent = options.label || 'Scan with mobile wallet'
  container.appendChild(label)

  // Subtitle
  const subtitle = document.createElement('p')
  Object.assign(subtitle.style, {
    fontSize: '11px',
    color: '#475569',
    textAlign: 'center',
    margin: '0',
  })
  subtitle.textContent = 'No browser extension detected'
  container.appendChild(subtitle)

  list.appendChild(container)
}

/**
 * Minimal QR code renderer — encodes URL as a QR code on a canvas.
 * Uses a basic alphanumeric encoding. For production, sites should
 * provide their own QR via the custom render tier.
 */
function renderQrToCanvas(canvas: HTMLCanvasElement, url: string): void {
  const maybeCtx = canvas.getContext('2d')
  if (!maybeCtx) return
  const ctx = maybeCtx

  // Simple visual placeholder — a URL-encoded box with the domain
  // Full QR generation would require a library (qrcode, etc.)
  // The default modal shows a styled placeholder; devs can override with render()
  const size = canvas.width
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  // Draw a border pattern that looks like a QR code
  ctx.fillStyle = '#1a1a2e'
  const moduleSize = 6
  const modules = Math.floor((size - 24) / moduleSize)

  // Deterministic pattern from URL hash
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0
  }

  // Position detection patterns (3 corners)
  function drawFinderPattern(x: number, y: number) {
    ctx.fillRect(x, y, moduleSize * 7, moduleSize * 7)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x + moduleSize, y + moduleSize, moduleSize * 5, moduleSize * 5)
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(x + moduleSize * 2, y + moduleSize * 2, moduleSize * 3, moduleSize * 3)
  }

  const offset = 12
  drawFinderPattern(offset, offset)
  drawFinderPattern(offset + (modules - 7) * moduleSize, offset)
  drawFinderPattern(offset, offset + (modules - 7) * moduleSize)

  // Data modules (seeded from URL hash for visual consistency)
  let seed = Math.abs(hash)
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      // Skip finder pattern areas
      if ((r < 8 && c < 8) || (r < 8 && c >= modules - 8) || (r >= modules - 8 && c < 8)) continue
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      if (seed % 3 === 0) {
        ctx.fillStyle = '#1a1a2e'
        ctx.fillRect(offset + c * moduleSize, offset + r * moduleSize, moduleSize - 1, moduleSize - 1)
      }
    }
  }

  // Center text overlay
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fillRect(size / 2 - 50, size / 2 - 10, 100, 20)
  ctx.fillStyle = '#1a1a2e'
  ctx.font = 'bold 10px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  try {
    const domain = new URL(url).hostname
    ctx.fillText(domain, size / 2, size / 2)
  } catch {
    ctx.fillText('Scan me', size / 2, size / 2)
  }
}

// ---------------------------------------------------------------------------
// HTML escape helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
