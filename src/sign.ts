/**
 * Site-side signing — request a document signature from a credential wallet.
 *
 * Follows the same nonce-based event pattern as discover/announce:
 *   1. Site dispatches `credential-wallet:sign` with nonce + request
 *   2. Wallet extension shows consent popup
 *   3. Wallet responds with `credential-wallet:sign-response` + nonce + result
 */

import { SIGN_EVENT, SIGN_RESPONSE_EVENT } from './constants'
import type {
  WalletAnnouncement,
  SignRequest,
  SignResponse,
  SignDetail,
  SignResponseDetail,
} from './types'

export interface RequestSignatureOptions {
  /** How long to wait for the wallet to respond (default 120s — user needs time to consent) */
  timeoutMs?: number
}

/**
 * Request a document signature from a specific wallet.
 *
 * The wallet extension receives the request, shows a consent popup to the user,
 * and responds with the DID signature. The promise resolves with the signature
 * response or `null` if the user rejects / times out.
 *
 * @param wallet   The wallet to sign with (from discoverWallets or pickWallet)
 * @param request  What to sign (hash, fileName, hashAlgorithm)
 * @param options  Optional timeout configuration
 * @returns SignResponse if approved, null if rejected or timed out
 *
 * @example
 * ```ts
 * import { discoverWallets, requestSignature } from '@attestto/id-wallet-adapter'
 *
 * const [wallet] = await discoverWallets()
 * const result = await requestSignature(wallet, {
 *   hash: 'abc123...',
 *   fileName: 'contract.pdf',
 *   hashAlgorithm: 'SHA-256',
 * })
 *
 * if (result?.approved) {
 *   console.log('Signed by', result.did)
 * }
 * ```
 */
export function requestSignature(
  wallet: WalletAnnouncement,
  request: SignRequest,
  options: RequestSignatureOptions = {},
): Promise<SignResponse | null> {
  const { timeoutMs = 120_000 } = options

  return new Promise((resolve) => {
    const nonce = `cw-sign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener(SIGN_RESPONSE_EVENT, onResponse)
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)

    function onResponse(e: Event) {
      const detail = (e as CustomEvent<SignResponseDetail>).detail
      if (detail?.nonce !== nonce) return

      cleanup()
      resolve(detail.response)
    }

    window.addEventListener(SIGN_RESPONSE_EVENT, onResponse)

    window.dispatchEvent(
      new CustomEvent<SignDetail>(SIGN_EVENT, {
        detail: {
          nonce,
          walletDid: wallet.did,
          request,
        },
      }),
    )
  })
}
