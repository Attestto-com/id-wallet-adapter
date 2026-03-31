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

/** Options for pickWallet */
export interface PickWalletOptions {
  /** Discovery timeout in ms (default 2000 — longer than discoverWallets to catch late arrivals) */
  timeoutMs?: number
  /** Only show wallets that support ALL of these protocols. Omit to show all. */
  requiredProtocols?: WalletProtocol[]
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

    // Timeout — if no wallets found, cancel
    const timer = setTimeout(() => {
      if (!settled && wallets.length === 0) {
        onCancel()
      }
      // If wallets exist but user hasn't picked, keep modal open
      // (renderer.destroy handles eventual cleanup)
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
    destroy: () => {
      backdrop.remove()
    },
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
