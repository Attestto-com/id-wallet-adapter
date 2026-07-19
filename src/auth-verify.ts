/**
 * DID-auth verification — the mandatory trust boundary for the `requestAuth` flow.
 *
 * `requestAuth` resolves with whatever a page `window` CustomEvent carried, which
 * ANY in-page script or extension can forge (`{approved:true, did:'did:victim'}`).
 * `approved` is therefore NOT an authentication result. A relying party MUST call
 * `verifyAuth` and treat only `authenticated === true` as proof of the DID.
 *
 * verifyAuth enforces, fail-closed:
 *   1. the response carries did/signature/publicKeyJwk/timestamp,
 *   2. the signature is cryptographically valid over the canonical payload,
 *   3. the signing key is bound to the DID (present in the DID Document's
 *      `authentication` verification relationship),
 *   4. nonce/audience/origin match what the verifier issued, and the timestamp
 *      is within the freshness window.
 */

import type { AuthResponse } from './types'
import { resolveDid } from './verify'

/** Version tag prefixed to the signed payload so signatures cannot be reused across protocol revisions. */
export const DID_AUTH_CANONICAL_VERSION = 'attestto-did-auth-v1'

export interface VerifyAuthOptions {
  /** The nonce the verifier issued in the AuthRequest. Required, non-empty. */
  expectedNonce: string
  /** The audience the verifier issued (its origin or DID). Required, non-empty. */
  expectedAudience: string
  /** The origin the verifier issued. Required, non-empty. */
  expectedOrigin: string
  /** DID resolver base URL (same shape used by verifyPresentation). */
  resolverUrl: string
  /** Max age in seconds for the response timestamp. Default 300. */
  maxAgeSeconds?: number
  signal?: AbortSignal
}

export interface AuthVerifyResult {
  authenticated: boolean
  did: string | null
  errors: AuthVerifyError[]
}

export interface AuthVerifyError {
  code: AuthVerifyErrorCode
  message: string
}

export type AuthVerifyErrorCode =
  | 'EXPECTED_PARAMS_MISSING'
  | 'NOT_APPROVED'
  | 'MISSING_FIELDS'
  | 'NONCE_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'ORIGIN_MISMATCH'
  | 'STALE'
  | 'UNSUPPORTED_KEY'
  | 'SIGNATURE_INVALID'
  | 'RESOLUTION_FAILED'
  | 'KEY_NOT_IN_AUTHENTICATION'

/** Tolerance, in seconds, for a timestamp dated in the future (clock skew). */
const FUTURE_SKEW_TOLERANCE_SECONDS = 60

/**
 * The exact bytes the wallet signs. Line-oriented, LF-joined, no trailing newline:
 *
 *   attestto-did-auth-v1
 *   <did>
 *   <nonce>
 *   <audience>
 *   <origin>
 *   <timestamp>
 *
 * This is the cross-repo contract: the credential wallet MUST sign this exact
 * string for verifyAuth to accept the response.
 */
export function canonicalAuthMessage(fields: {
  did: string
  nonce: string
  audience: string
  origin: string
  timestamp: string
}): string {
  return [
    DID_AUTH_CANONICAL_VERSION,
    fields.did,
    fields.nonce,
    fields.audience,
    fields.origin,
    fields.timestamp,
  ].join('\n')
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export async function verifyAuth(
  response: AuthResponse,
  options: VerifyAuthOptions,
): Promise<AuthVerifyResult> {
  const errors: AuthVerifyError[] = []
  const respDid = typeof response?.did === 'string' ? response.did : null
  const fail = (did: string | null = respDid): AuthVerifyResult => ({ authenticated: false, did, errors })

  // Fail closed on caller misconfiguration — a blank expected value must never authenticate.
  if (
    !isNonEmptyString(options.expectedNonce) ||
    !isNonEmptyString(options.expectedAudience) ||
    !isNonEmptyString(options.expectedOrigin)
  ) {
    errors.push({
      code: 'EXPECTED_PARAMS_MISSING',
      message: 'expectedNonce, expectedAudience and expectedOrigin are required and must be non-empty',
    })
    return fail()
  }

  if (!response || response.approved !== true) {
    errors.push({ code: 'NOT_APPROVED', message: 'Auth response is not approved (this is not an authentication result)' })
    return fail()
  }

  const { did, nonce, audience, origin, signature, publicKeyJwk, timestamp } = response
  if (
    !isNonEmptyString(did) ||
    !isNonEmptyString(nonce) ||
    !isNonEmptyString(audience) ||
    !isNonEmptyString(origin) ||
    !isNonEmptyString(signature) ||
    !publicKeyJwk ||
    !isNonEmptyString(timestamp)
  ) {
    errors.push({
      code: 'MISSING_FIELDS',
      message: 'Approved auth response must carry did, nonce, audience, origin, signature, publicKeyJwk and timestamp',
    })
    return fail()
  }

  // Binding: the echoed nonce/audience/origin must match what the verifier issued.
  // These are the values the signature is checked over (below), so a mismatch here is
  // a replay or wrong-audience response even if the signature over the echoed values
  // is itself valid.
  if (nonce !== options.expectedNonce) {
    errors.push({ code: 'NONCE_MISMATCH', message: 'Auth response nonce does not match the expected nonce (replay)' })
  }
  if (audience !== options.expectedAudience) {
    errors.push({ code: 'AUDIENCE_MISMATCH', message: 'Auth response audience does not match the expected audience' })
  }
  if (origin !== options.expectedOrigin) {
    errors.push({ code: 'ORIGIN_MISMATCH', message: 'Auth response origin does not match the expected origin' })
  }

  // Freshness.
  const createdMs = Date.parse(timestamp)
  if (Number.isNaN(createdMs)) {
    errors.push({ code: 'STALE', message: 'Auth response timestamp is not a valid date' })
  } else {
    const maxAge = options.maxAgeSeconds ?? 300
    const ageSeconds = (Date.now() - createdMs) / 1000
    if (ageSeconds > maxAge) {
      errors.push({ code: 'STALE', message: `Auth response is older than ${maxAge}s` })
    } else if (ageSeconds < -FUTURE_SKEW_TOLERANCE_SECONDS) {
      errors.push({ code: 'STALE', message: 'Auth response timestamp is in the future' })
    }
  }

  // Signature must verify over the canonical payload built from the response's OWN
  // echoed values. Combined with the binding check above (echoed === expected), this
  // proves the wallet signed the verifier's exact nonce/audience/origin.
  const message = canonicalAuthMessage({ did, nonce, audience, origin, timestamp })
  let sigValid = false
  try {
    const key = await importVerifyKey(publicKeyJwk)
    if (!key) {
      errors.push({
        code: 'UNSUPPORTED_KEY',
        message: `Unsupported key type for verification: ${publicKeyJwk.kty}/${publicKeyJwk.crv ?? ''}`,
      })
      return fail(did)
    }
    sigValid = await globalThis.crypto.subtle.verify(
      key.verifyAlgorithm,
      key.cryptoKey,
      base64urlToBytes(signature),
      new TextEncoder().encode(message),
    )
  } catch {
    sigValid = false
  }
  if (!sigValid) {
    errors.push({ code: 'SIGNATURE_INVALID', message: 'Auth signature does not verify over the canonical payload' })
    return fail(did)
  }

  // Key → DID binding: the signing key must be published in the DID's `authentication`.
  let didDocument: Record<string, unknown> | null
  try {
    didDocument = await resolveDid(did, options.resolverUrl, options.signal)
  } catch {
    errors.push({ code: 'RESOLUTION_FAILED', message: `Could not resolve ${did}` })
    return fail(did)
  }
  if (!didDocument) {
    errors.push({ code: 'RESOLUTION_FAILED', message: `No DID Document for ${did}` })
    return fail(did)
  }
  if (!keyInAuthentication(didDocument, publicKeyJwk)) {
    errors.push({
      code: 'KEY_NOT_IN_AUTHENTICATION',
      message: 'Signing key is not in the DID Document authentication relationship',
    })
    return fail(did)
  }

  return { authenticated: errors.length === 0, did, errors }
}

interface ImportedKey {
  cryptoKey: CryptoKey
  verifyAlgorithm: AlgorithmIdentifier | EcdsaParams
}

async function importVerifyKey(jwk: JsonWebKey): Promise<ImportedKey | null> {
  const subtle = globalThis.crypto.subtle
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    const cryptoKey = await subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
    return { cryptoKey, verifyAlgorithm: { name: 'Ed25519' } }
  }
  if (jwk.kty === 'EC' && jwk.crv === 'P-256') {
    const cryptoKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return { cryptoKey, verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-256' } }
  }
  return null
}

function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A DID Document `authentication` entry is either a VM id (string) or an embedded VM object. */
function keyInAuthentication(didDocument: Record<string, unknown>, jwk: JsonWebKey): boolean {
  const auth = didDocument.authentication
  if (!Array.isArray(auth)) return false
  const vms = Array.isArray(didDocument.verificationMethod)
    ? (didDocument.verificationMethod as Record<string, unknown>[])
    : []

  for (const entry of auth) {
    let vm: Record<string, unknown> | undefined
    if (typeof entry === 'string') {
      vm = vms.find((m) => m.id === entry)
    } else if (entry && typeof entry === 'object') {
      vm = entry as Record<string, unknown>
    }
    if (!vm) continue
    const vmJwk = vm.publicKeyJwk as JsonWebKey | undefined
    if (vmJwk && jwkPublicKeysMatch(vmJwk, jwk)) return true
  }
  return false
}

/** Compare the public portions of two JWKs (OKP: kty/crv/x; EC: kty/crv/x/y). */
function jwkPublicKeysMatch(a: JsonWebKey, b: JsonWebKey): boolean {
  if (a.kty !== b.kty || a.crv !== b.crv) return false
  if (a.x !== b.x) return false
  if (a.kty === 'EC') return a.y === b.y
  return true
}
