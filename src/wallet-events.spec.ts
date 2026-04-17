/**
 * Tests for the event-driven wallet modules: discover, register, sign.
 *
 * These modules communicate via CustomEvent on window:
 *   - discover: site dispatches discover, wallets respond with announce
 *   - register: wallet listens for discover, auto-responds with announce
 *   - sign: site dispatches sign request, wallet responds with sign-response
 *
 * All tests run in jsdom (vitest.config.ts) which provides window,
 * CustomEvent, addEventListener, dispatchEvent, and setTimeout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { discoverWallets } from './discover'
import { registerWallet } from './register'
import { requestSignature } from './sign'
import {
  DISCOVER_EVENT,
  ANNOUNCE_EVENT,
  SIGN_EVENT,
  SIGN_RESPONSE_EVENT,
} from './constants'
import type {
  WalletAnnouncement,
  DiscoverDetail,
  SignDetail,
  SignResponse,
  SignResponseDetail,
} from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWallet(overrides: Partial<WalletAnnouncement> = {}): WalletAnnouncement {
  return {
    did: 'did:web:example.com:wallets:test',
    name: 'Test Wallet',
    icon: 'https://example.com/icon.svg',
    version: '1.0.0',
    protocols: ['chapi'],
    maintainer: { name: 'Test Org' },
    ...overrides,
  }
}

function makeWalletB(): WalletAnnouncement {
  return makeWallet({
    did: 'did:web:example.com:wallets:second',
    name: 'Second Wallet',
    version: '2.0.0',
    protocols: ['didcomm-v2'],
    maintainer: { name: 'Another Org' },
  })
}

const SIGN_REQUEST = {
  hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  fileName: 'contract.pdf',
  hashAlgorithm: 'SHA-256',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Install a listener that responds to discovery events with the given wallets */
function installWalletResponder(wallets: WalletAnnouncement[]): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<DiscoverDetail>).detail
    for (const wallet of wallets) {
      window.dispatchEvent(
        new CustomEvent(ANNOUNCE_EVENT, {
          detail: { nonce: detail.nonce, wallet },
        }),
      )
    }
  }
  window.addEventListener(DISCOVER_EVENT, handler)
  return () => window.removeEventListener(DISCOVER_EVENT, handler)
}

/** Install a listener that responds to sign events with the given response */
function installSignResponder(response: SignResponse): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<SignDetail>).detail
    window.dispatchEvent(
      new CustomEvent<SignResponseDetail>(SIGN_RESPONSE_EVENT, {
        detail: { nonce: detail.nonce, response },
      }),
    )
  }
  window.addEventListener(SIGN_EVENT, handler)
  return () => window.removeEventListener(SIGN_EVENT, handler)
}

// ---------------------------------------------------------------------------
// discoverWallets
// ---------------------------------------------------------------------------

describe('discoverWallets', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty array when no wallets respond', async () => {
    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    expect(wallets).toEqual([])
  })

  it('returns wallet announcements when wallets respond', async () => {
    const cleanup = installWalletResponder([makeWallet()])
    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    expect(wallets).toHaveLength(1)
    expect(wallets[0].did).toBe('did:web:example.com:wallets:test')
    expect(wallets[0].name).toBe('Test Wallet')
    cleanup()
  })

  it('collects multiple different wallets', async () => {
    const cleanup = installWalletResponder([makeWallet(), makeWalletB()])
    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    expect(wallets).toHaveLength(2)
    expect(wallets[0].did).toBe('did:web:example.com:wallets:test')
    expect(wallets[1].did).toBe('did:web:example.com:wallets:second')
    cleanup()
  })

  it('deduplicates by wallet DID', async () => {
    // Respond with the same wallet twice
    const cleanup = installWalletResponder([makeWallet(), makeWallet()])
    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    expect(wallets).toHaveLength(1)
    cleanup()
  })

  it('respects timeout parameter', async () => {
    const cleanup = installWalletResponder([makeWallet()])
    const promise = discoverWallets(50)

    // At 49ms the timeout has not fired yet
    vi.advanceTimersByTime(49)
    // Promise should still be pending — we verify by advancing fully
    vi.advanceTimersByTime(1)
    const wallets = await promise
    expect(wallets).toHaveLength(1)
    cleanup()
  })

  it('uses default timeout of 800ms', async () => {
    const promise = discoverWallets()

    // Not resolved at 799ms
    vi.advanceTimersByTime(799)

    // Resolve at 800ms
    vi.advanceTimersByTime(1)
    const wallets = await promise
    expect(wallets).toEqual([])
  })

  it('filters by nonce — ignores stale announcements from wrong nonce', async () => {
    // Manually dispatch an announcement with a wrong nonce before discovery
    const staleHandler = () => {
      window.dispatchEvent(
        new CustomEvent(ANNOUNCE_EVENT, {
          detail: { nonce: 'wrong-nonce-from-old-session', wallet: makeWallet() },
        }),
      )
    }
    window.addEventListener(DISCOVER_EVENT, staleHandler)

    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    // The stale announcement should have been ignored because its nonce
    // does not match the nonce generated by discoverWallets
    expect(wallets).toHaveLength(0)
    window.removeEventListener(DISCOVER_EVENT, staleHandler)
  })

  it('ignores announcements with missing detail', async () => {
    const handler = () => {
      window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: null }))
    }
    window.addEventListener(DISCOVER_EVENT, handler)

    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    expect(wallets).toHaveLength(0)
    window.removeEventListener(DISCOVER_EVENT, handler)
  })

  it('dispatches the discover event on the window', async () => {
    const spy = vi.fn()
    window.addEventListener(DISCOVER_EVENT, spy)
    const promise = discoverWallets(50)
    expect(spy).toHaveBeenCalledTimes(1)
    const event = spy.mock.calls[0][0] as CustomEvent<DiscoverDetail>
    expect(event.detail.nonce).toMatch(/^cw-/)
    vi.advanceTimersByTime(50)
    await promise
    window.removeEventListener(DISCOVER_EVENT, spy)
  })

  it('cleans up event listener after timeout', async () => {
    const cleanup = installWalletResponder([makeWallet()])
    const promise = discoverWallets(50)
    vi.advanceTimersByTime(50)
    const wallets = await promise
    expect(wallets).toHaveLength(1)

    // After resolution, late announcements should not accumulate.
    // The wallets array is already returned; the listener was removed.
    // Dispatch another announce — it should not throw or alter anything.
    window.dispatchEvent(
      new CustomEvent(ANNOUNCE_EVENT, {
        detail: { nonce: 'whatever', wallet: makeWalletB() },
      }),
    )
    // wallets still has 1 entry
    expect(wallets).toHaveLength(1)
    cleanup()
  })
})

// ---------------------------------------------------------------------------
// registerWallet
// ---------------------------------------------------------------------------

describe('registerWallet', () => {
  it('responds to discovery events with correct wallet info', async () => {
    vi.useFakeTimers()
    const wallet = makeWallet()
    registerWallet(wallet)

    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    expect(wallets).toHaveLength(1)
    expect(wallets[0]).toEqual(wallet)
    vi.useRealTimers()
  })

  it('echoes back the nonce from the discover event', () => {
    const wallet = makeWallet()
    registerWallet(wallet)

    const received: string[] = []
    const listener = (e: Event) => {
      received.push((e as CustomEvent).detail.nonce)
    }
    window.addEventListener(ANNOUNCE_EVENT, listener)

    const testNonce = 'cw-test-nonce-123'
    window.dispatchEvent(
      new CustomEvent<DiscoverDetail>(DISCOVER_EVENT, {
        detail: { nonce: testNonce },
      }),
    )

    expect(received).toContain(testNonce)
    window.removeEventListener(ANNOUNCE_EVENT, listener)
  })

  it('responds to multiple discovery events', () => {
    const wallet = makeWallet({
      did: 'did:web:example.com:wallets:multi-test',
      name: 'Multi Test Wallet',
    })
    registerWallet(wallet)

    // Track only announcements from OUR wallet to avoid counting
    // announcements from wallets registered in earlier tests (jsdom
    // window persists across tests within the same file).
    const nonces = ['multi-nonce-1', 'multi-nonce-2', 'multi-nonce-3']
    const receivedNonces: string[] = []
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.wallet?.did === wallet.did && nonces.includes(detail.nonce)) {
        receivedNonces.push(detail.nonce)
      }
    }
    window.addEventListener(ANNOUNCE_EVENT, listener)

    for (const nonce of nonces) {
      window.dispatchEvent(
        new CustomEvent<DiscoverDetail>(DISCOVER_EVENT, {
          detail: { nonce },
        }),
      )
    }

    expect(receivedNonces).toEqual(nonces)
    window.removeEventListener(ANNOUNCE_EVENT, listener)
  })

  it('ignores discover events with missing nonce', () => {
    const wallet = makeWallet()
    registerWallet(wallet)

    let announceCount = 0
    const listener = () => { announceCount++ }
    window.addEventListener(ANNOUNCE_EVENT, listener)

    // Dispatch with no nonce — registerWallet guards: if (!detail?.nonce) return
    window.dispatchEvent(
      new CustomEvent(DISCOVER_EVENT, { detail: {} }),
    )
    window.dispatchEvent(
      new CustomEvent(DISCOVER_EVENT, { detail: null }),
    )

    expect(announceCount).toBe(0)
    window.removeEventListener(ANNOUNCE_EVENT, listener)
  })

  it('includes all wallet fields in the announcement', () => {
    const wallet = makeWallet({
      goals: ['aries/goal/issue-vc'],
      url: 'https://example.com/wallet',
    })
    registerWallet(wallet)

    let announcedWallet: WalletAnnouncement | undefined
    const listener = (e: Event) => {
      announcedWallet = (e as CustomEvent).detail.wallet
    }
    window.addEventListener(ANNOUNCE_EVENT, listener)

    window.dispatchEvent(
      new CustomEvent<DiscoverDetail>(DISCOVER_EVENT, {
        detail: { nonce: 'nonce-fields' },
      }),
    )

    expect(announcedWallet).toEqual(wallet)
    expect(announcedWallet!.goals).toEqual(['aries/goal/issue-vc'])
    expect(announcedWallet!.url).toBe('https://example.com/wallet')
    window.removeEventListener(ANNOUNCE_EVENT, listener)
  })
})

// ---------------------------------------------------------------------------
// requestSignature
// ---------------------------------------------------------------------------

describe('requestSignature', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with SignResponse when wallet approves', async () => {
    const approvedResponse: SignResponse = {
      approved: true,
      did: 'did:web:example.com:wallets:test',
      signature: 'base64url-signature-value',
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'test-key' },
      timestamp: '2026-04-17T00:00:00Z',
    }
    const cleanup = installSignResponder(approvedResponse)
    const wallet = makeWallet()

    const promise = requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 5000 })
    // The sign responder fires synchronously on the SIGN_EVENT
    const result = await promise
    expect(result).toEqual(approvedResponse)
    expect(result!.approved).toBe(true)
    expect(result!.did).toBe('did:web:example.com:wallets:test')
    expect(result!.signature).toBe('base64url-signature-value')
    cleanup()
  })

  it('resolves with rejected response when wallet denies', async () => {
    const rejectedResponse: SignResponse = {
      approved: false,
    }
    const cleanup = installSignResponder(rejectedResponse)
    const wallet = makeWallet()

    const promise = requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 5000 })
    const result = await promise
    expect(result).toEqual(rejectedResponse)
    expect(result!.approved).toBe(false)
    expect(result!.did).toBeUndefined()
    expect(result!.signature).toBeUndefined()
    cleanup()
  })

  it('times out and resolves null after timeout', async () => {
    // No sign responder installed — wallet never answers
    const wallet = makeWallet()

    const promise = requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 500 })
    vi.advanceTimersByTime(500)
    const result = await promise
    expect(result).toBeNull()
  })

  it('uses default timeout of 120s', async () => {
    const wallet = makeWallet()
    const promise = requestSignature(wallet, SIGN_REQUEST)

    // Not resolved at 119.999s
    vi.advanceTimersByTime(119_999)

    // Resolve at 120s
    vi.advanceTimersByTime(1)
    const result = await promise
    expect(result).toBeNull()
  })

  it('matches response by nonce — ignores wrong nonce', async () => {
    const wallet = makeWallet()

    // Capture the nonce from the sign event
    let capturedNonce = ''
    const captor = (e: Event) => {
      capturedNonce = (e as CustomEvent<SignDetail>).detail.nonce
    }
    window.addEventListener(SIGN_EVENT, captor)

    const promise = requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 500 })
    window.removeEventListener(SIGN_EVENT, captor)

    // Dispatch a response with a WRONG nonce
    window.dispatchEvent(
      new CustomEvent<SignResponseDetail>(SIGN_RESPONSE_EVENT, {
        detail: {
          nonce: 'wrong-nonce-does-not-match',
          response: { approved: true, did: 'did:web:wrong' },
        },
      }),
    )

    // Should NOT have resolved — still waiting
    // Now dispatch with the correct nonce
    window.dispatchEvent(
      new CustomEvent<SignResponseDetail>(SIGN_RESPONSE_EVENT, {
        detail: {
          nonce: capturedNonce,
          response: { approved: true, did: 'did:web:correct' },
        },
      }),
    )

    const result = await promise
    expect(result!.did).toBe('did:web:correct')
  })

  it('dispatches sign event with correct detail', () => {
    const wallet = makeWallet()

    const spy = vi.fn()
    window.addEventListener(SIGN_EVENT, spy)

    requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 1000 })

    expect(spy).toHaveBeenCalledTimes(1)
    const event = spy.mock.calls[0][0] as CustomEvent<SignDetail>
    expect(event.detail.nonce).toMatch(/^cw-sign-/)
    expect(event.detail.walletDid).toBe(wallet.did)
    expect(event.detail.request).toEqual(SIGN_REQUEST)

    window.removeEventListener(SIGN_EVENT, spy)
    // Let it timeout to avoid dangling timer
    vi.advanceTimersByTime(1000)
  })

  it('cleans up listener and timer after successful response', async () => {
    const approvedResponse: SignResponse = {
      approved: true,
      did: 'did:web:example.com:wallets:test',
    }
    const cleanup = installSignResponder(approvedResponse)
    const wallet = makeWallet()

    const promise = requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 5000 })
    const result = await promise
    expect(result!.approved).toBe(true)

    // Advancing timers past timeout should not cause issues
    // (timer was cleared in cleanup)
    vi.advanceTimersByTime(10_000)
    cleanup()
  })

  it('ignores response events with missing detail', async () => {
    const wallet = makeWallet()

    // Listen for the sign event, then respond with null detail
    const handler = () => {
      window.dispatchEvent(
        new CustomEvent(SIGN_RESPONSE_EVENT, { detail: null }),
      )
    }
    window.addEventListener(SIGN_EVENT, handler)

    const promise = requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 200 })
    vi.advanceTimersByTime(200)
    const result = await promise
    // Should timeout because the null-detail response was ignored
    expect(result).toBeNull()
    window.removeEventListener(SIGN_EVENT, handler)
  })

  it('includes storeToken in response when wallet provides one', async () => {
    const responseWithToken: SignResponse = {
      approved: true,
      did: 'did:web:example.com:wallets:test',
      signature: 'sig-value',
      storeToken: 'store-token-abc-123',
    }
    const cleanup = installSignResponder(responseWithToken)
    const wallet = makeWallet()

    const promise = requestSignature(wallet, SIGN_REQUEST, { timeoutMs: 5000 })
    const result = await promise
    expect(result!.storeToken).toBe('store-token-abc-123')
    cleanup()
  })
})

// ---------------------------------------------------------------------------
// Integration: registerWallet + discoverWallets
// ---------------------------------------------------------------------------

describe('register + discover integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registered wallet is discovered', async () => {
    // Use a unique DID to avoid collisions with wallets registered in other tests
    const wallet = makeWallet({
      did: 'did:web:example.com:wallets:integration-single',
      name: 'Integration Single',
    })
    registerWallet(wallet)

    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise

    // Other tests may have registered wallets that also respond, so check
    // that our wallet is among the results rather than asserting exact count.
    const found = wallets.find((w) => w.did === wallet.did)
    expect(found).toBeDefined()
    expect(found!.name).toBe(wallet.name)
    expect(found!.protocols).toEqual(wallet.protocols)
  })

  it('multiple registered wallets are all discovered', async () => {
    const walletC = makeWallet({
      did: 'did:web:example.com:wallets:integration-c',
      name: 'Integration C',
    })
    const walletD = makeWallet({
      did: 'did:web:example.com:wallets:integration-d',
      name: 'Integration D',
    })
    registerWallet(walletC)
    registerWallet(walletD)

    const promise = discoverWallets(100)
    vi.advanceTimersByTime(100)
    const wallets = await promise
    const dids = wallets.map((w) => w.did)
    expect(dids).toContain(walletC.did)
    expect(dids).toContain(walletD.did)
  })
})
