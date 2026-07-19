/**
 * Site-side authentication — request a DID-based login from a credential wallet.
 *
 * Mirrors the discover/announce and sign/sign-response patterns:
 *   1. Site dispatches `credential-wallet:auth` with nonce + request
 *   2. Wallet extension shows consent popup (user picks identity if multiple)
 *   3. Wallet responds with `credential-wallet:auth-response` + nonce + result
 *
 * The `trustedIssuers` field on the request lets the wallet filter the user's
 * identities to those the verifier will accept (avoids the "user signs, site
 * rejects, user retries" loop).
 */

import { AUTH_EVENT, AUTH_RESPONSE_EVENT } from './constants'
import type {
  WalletAnnouncement,
  AuthRequest,
  UnverifiedAuthResponse,
  AuthDetail,
  AuthResponseDetail,
} from './types'

export interface RequestAuthOptions {
  /** How long to wait for the wallet to respond (default 120s — user needs time to consent) */
  timeoutMs?: number
}

/**
 * Request DID-based authentication from a specific wallet.
 *
 * @param wallet   The wallet to authenticate with (from discoverWallets or pickWallet)
 * @param request  The auth challenge (nonce, audience, origin, optional trustedIssuers)
 * @param options  Optional timeout configuration
 * @returns An **unverified** response if approved, null if rejected or timed out.
 *
 * SECURITY: the result arrives over a page `window` event that any script can
 * forge, so `approved`/`did` are NOT proof of authentication. You MUST pass the
 * result to `verifyAuth` and trust only `authenticated === true`.
 *
 * @example
 * ```ts
 * import { discoverWallets, requestAuth, verifyAuth } from '@attestto/id-wallet-adapter'
 *
 * const [wallet] = await discoverWallets()
 * const nonce = crypto.randomUUID()
 * const audience = window.location.origin
 * const origin = window.location.origin
 * const result = await requestAuth(wallet, { nonce, audience, origin })
 *
 * if (result) {
 *   const verified = await verifyAuth(result, {
 *     expectedNonce: nonce,
 *     expectedAudience: audience,
 *     expectedOrigin: origin,
 *     resolverUrl: 'https://resolver.example',
 *   })
 *   if (verified.authenticated) console.log('Authenticated as', verified.did)
 * }
 * ```
 */
export function requestAuth(
  wallet: WalletAnnouncement,
  request: AuthRequest,
  options: RequestAuthOptions = {},
): Promise<UnverifiedAuthResponse | null> {
  const { timeoutMs = 120_000 } = options

  return new Promise((resolve) => {
    const envelopeNonce = `cw-auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener(AUTH_RESPONSE_EVENT, onResponse)
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)

    function onResponse(e: Event) {
      const detail = (e as CustomEvent<AuthResponseDetail>).detail
      if (detail?.nonce !== envelopeNonce) return

      cleanup()
      resolve(detail.response)
    }

    window.addEventListener(AUTH_RESPONSE_EVENT, onResponse)

    window.dispatchEvent(
      new CustomEvent<AuthDetail>(AUTH_EVENT, {
        detail: {
          nonce: envelopeNonce,
          walletDid: wallet.did,
          request,
        },
      }),
    )
  })
}
