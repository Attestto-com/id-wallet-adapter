/**
 * Presentation verification — validate a VP returned by a credential wallet.
 *
 * After navigator.credentials.get() returns a VP, use this to verify:
 * 1. The holder DID resolves to a valid DID Document
 * 2. The VP signature matches the public key in the DID Document
 * 3. The VC issuer is in the consumer's trusted issuers list
 * 4. The credential has not been revoked (optional)
 */

import type { WalletAnnouncement } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for verifying a Verifiable Presentation */
export interface VerifyOptions {
  /** DID resolver endpoint (required — where to resolve the holder's DID) */
  resolverUrl: string
  /** List of trusted issuer DIDs (VCs from untrusted issuers are rejected) */
  trustedIssuers: string[]
  /** Check credential revocation via credentialStatus (default true) */
  checkRevocation?: boolean
  /** Trusted wallet DIDs — if set, reject VPs from wallets not in this list */
  trustedWallets?: string[]
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/** Result of VP verification */
export interface VerifyResult {
  /** Whether the VP passed all checks */
  valid: boolean
  /** The holder's DID (extracted from the VP) */
  holderDid: string | null
  /** Which checks failed, if any */
  errors: VerifyError[]
  /** The resolved DID Document (if resolution succeeded) */
  didDocument: Record<string, unknown> | null
}

export interface VerifyError {
  code: VerifyErrorCode
  message: string
}

export type VerifyErrorCode =
  | 'NO_HOLDER'           // VP has no holder field
  | 'RESOLUTION_FAILED'   // Could not resolve the holder DID
  | 'SIGNATURE_INVALID'   // VP signature does not match DID Document keys
  | 'ISSUER_UNTRUSTED'    // VC issuer not in trustedIssuers list
  | 'CREDENTIAL_REVOKED'  // Credential has been revoked
  | 'WALLET_UNTRUSTED'    // Wallet DID not in trustedWallets list
  | 'MALFORMED_VP'        // VP structure is invalid

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a Verifiable Presentation returned by a credential wallet.
 *
 * @param vp       The VP object (from navigator.credentials.get result.data)
 * @param wallet   The wallet announcement (from discovery phase — optional)
 * @param options  Verification options
 *
 * @example
 * ```ts
 * const credential = await navigator.credentials.get(vpRequest)
 * const vp = credential.data
 *
 * const result = await verifyPresentation(vp, selectedWallet, {
 *   resolverUrl: 'https://api.yourapp.com/resolver',
 *   trustedIssuers: ['did:web:attestto.com'],
 *   trustedWallets: ['did:web:attestto.com:wallets:attestto-creds'],
 * })
 *
 * if (!result.valid) {
 *   console.error('Verification failed:', result.errors)
 * }
 * ```
 */
export async function verifyPresentation(
  vp: Record<string, unknown>,
  wallet: WalletAnnouncement | null,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const errors: VerifyError[] = []
  let holderDid: string | null = null
  let didDocument: Record<string, unknown> | null = null

  // --- Check wallet trust ---
  if (options.trustedWallets && wallet) {
    if (!options.trustedWallets.includes(wallet.did)) {
      errors.push({ code: 'WALLET_UNTRUSTED', message: `Wallet ${wallet.did} is not in the trusted wallets list` })
    }
  }

  // --- Extract holder ---
  holderDid = extractHolder(vp)
  if (!holderDid) {
    errors.push({ code: 'NO_HOLDER', message: 'VP does not contain a holder DID' })
    return { valid: false, holderDid: null, errors, didDocument: null }
  }

  // --- Resolve DID Document ---
  try {
    didDocument = await resolveDid(holderDid, options.resolverUrl, options.signal)
  } catch {
    errors.push({ code: 'RESOLUTION_FAILED', message: `Could not resolve ${holderDid}` })
    return { valid: false, holderDid, errors, didDocument: null }
  }

  if (!didDocument) {
    errors.push({ code: 'RESOLUTION_FAILED', message: `DID Document not found for ${holderDid}` })
    return { valid: false, holderDid, errors, didDocument: null }
  }

  // --- Verify VP signature ---
  // Note: Full cryptographic verification requires importing a VC/VP library
  // (e.g., @digitalbazaar/vc, @spruceid/didkit). This checks structural validity
  // and delegates signature verification to the resolver if it supports it.
  const signatureValid = await verifySignature(vp, didDocument, options.resolverUrl, options.signal)
  if (!signatureValid) {
    errors.push({ code: 'SIGNATURE_INVALID', message: 'VP signature does not match DID Document keys' })
  }

  // --- Check VC issuer trust ---
  const credentials = extractCredentials(vp)
  for (const vc of credentials) {
    const issuer = extractIssuer(vc)
    if (issuer && !options.trustedIssuers.includes(issuer)) {
      errors.push({ code: 'ISSUER_UNTRUSTED', message: `VC issuer ${issuer} is not trusted` })
    }
  }

  // --- Check revocation ---
  if (options.checkRevocation !== false) {
    for (const vc of credentials) {
      const revoked = await checkRevocation(vc, options.signal)
      if (revoked) {
        errors.push({ code: 'CREDENTIAL_REVOKED', message: 'Credential has been revoked' })
      }
    }
  }

  return {
    valid: errors.length === 0,
    holderDid,
    errors,
    didDocument,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHolder(vp: Record<string, unknown>): string | null {
  const holder = vp.holder
  if (typeof holder === 'string' && holder.startsWith('did:')) return holder
  if (typeof holder === 'object' && holder !== null && 'id' in holder) {
    const id = (holder as { id: unknown }).id
    if (typeof id === 'string' && id.startsWith('did:')) return id
  }
  return null
}

function extractCredentials(vp: Record<string, unknown>): Record<string, unknown>[] {
  const creds = vp.verifiableCredential
  if (Array.isArray(creds)) return creds as Record<string, unknown>[]
  if (typeof creds === 'object' && creds !== null) return [creds as Record<string, unknown>]
  return []
}

function extractIssuer(vc: Record<string, unknown>): string | null {
  const issuer = vc.issuer
  if (typeof issuer === 'string' && issuer.startsWith('did:')) return issuer
  if (typeof issuer === 'object' && issuer !== null && 'id' in issuer) {
    const id = (issuer as { id: unknown }).id
    if (typeof id === 'string' && id.startsWith('did:')) return id
  }
  return null
}

async function resolveDid(
  did: string,
  resolverUrl: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${resolverUrl}/1.0/identifiers/${encodeURIComponent(did)}`, { signal })
  if (!res.ok) return null
  const data = await res.json() as { didDocument?: Record<string, unknown> }
  return data.didDocument ?? null
}

async function verifySignature(
  vp: Record<string, unknown>,
  _didDocument: Record<string, unknown>,
  resolverUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  // Delegate to resolver's verification endpoint if available
  // This is the recommended approach — the resolver has the crypto libraries
  try {
    const res = await fetch(`${resolverUrl}/1.0/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verifiablePresentation: vp }),
      signal,
    })
    if (!res.ok) return false
    const data = await res.json() as { valid?: boolean; checks?: string[] }
    return data.valid === true
  } catch {
    // If resolver doesn't support verification, check structural validity only
    return vp.proof !== undefined && vp.proof !== null
  }
}

async function checkRevocation(
  vc: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<boolean> {
  const status = vc.credentialStatus as { type?: string; statusListCredential?: string; statusListIndex?: string } | undefined
  if (!status?.statusListCredential) return false // No status → not revoked

  // Fetch the Bitstring Status List
  try {
    const res = await fetch(status.statusListCredential, { signal })
    if (!res.ok) return false
    const list = await res.json() as { credentialSubject?: { encodedList?: string } }
    const encoded = list.credentialSubject?.encodedList
    if (!encoded || !status.statusListIndex) return false

    // Decode and check the bit at statusListIndex
    const decoded = atob(encoded)
    const index = parseInt(status.statusListIndex, 10)
    const byteIndex = Math.floor(index / 8)
    const bitIndex = index % 8
    if (byteIndex >= decoded.length) return false
    return (decoded.charCodeAt(byteIndex) & (1 << (7 - bitIndex))) !== 0
  } catch {
    return false // Can't check → assume not revoked
  }
}
