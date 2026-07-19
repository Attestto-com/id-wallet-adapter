/**
 * verifyAuth — the mandatory verifier for the requestAuth (DID login) path (SOC-28).
 *
 * requestAuth returns an UNVERIFIED assertion over a page `window` event that any
 * script can forge. verifyAuth is the trust boundary: it checks the signature over
 * the canonical payload, binds the signing key to the DID's `authentication`
 * relationship, and enforces nonce/audience/origin/freshness. These tests use a
 * real WebCrypto Ed25519 key and a stubbed resolver.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyAuth, canonicalAuthMessage, type VerifyAuthOptions } from './auth-verify'
import type { AuthResponse } from './types'

const subtle = globalThis.crypto.subtle
const DID = 'did:sns:alice.attestto.sol'
const NONCE = 'nonce-abc-123'
const AUDIENCE = 'https://verifier.example'
const ORIGIN = 'https://verifier.example'

function bytesToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58btcEncode(bytes: Uint8Array): string {
  const digits = [0]
  for (const b of bytes) {
    let carry = b
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let out = ''
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += '1'
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]]
  return out
}

/** `publicKeyMultibase` (did-core form) for an Ed25519 JWK: z + base58btc(0xed01 || raw32). */
function ed25519Multibase(jwk: JsonWebKey): string {
  const raw = b64urlToBytes(jwk.x as string)
  const prefixed = new Uint8Array(2 + raw.length)
  prefixed[0] = 0xed
  prefixed[1] = 0x01
  prefixed.set(raw, 2)
  return 'z' + base58btcEncode(prefixed)
}

/** Build a signed, verifiable AuthResponse + a DID Document that lists the key under `authentication`. */
async function makeSignedResponse(overrides: {
  did?: string
  nonce?: string
  audience?: string
  origin?: string
  timestamp?: string
  tamperSignature?: boolean
} = {}): Promise<{ response: AuthResponse; didDocument: Record<string, unknown> }> {
  const { publicKey, privateKey } = (await subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKeyJwk = (await subtle.exportKey('jwk', publicKey)) as JsonWebKey

  const did = overrides.did ?? DID
  const nonce = overrides.nonce ?? NONCE
  const audience = overrides.audience ?? AUDIENCE
  const origin = overrides.origin ?? ORIGIN
  const timestamp = overrides.timestamp ?? new Date().toISOString()

  const message = canonicalAuthMessage({ did, nonce, audience, origin, timestamp })
  const sig = await subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(message))
  let signature = bytesToB64url(sig)
  if (overrides.tamperSignature) signature = signature.slice(0, -2) + (signature.endsWith('A') ? 'BB' : 'AA')

  const didDocument = {
    id: did,
    verificationMethod: [{ id: `${did}#key-1`, type: 'JsonWebKey2020', controller: did, publicKeyJwk }],
    authentication: [`${did}#key-1`],
  }

  return {
    response: { approved: true, did, nonce, audience, origin, signature, publicKeyJwk, timestamp },
    didDocument,
  }
}

function options(over: Partial<VerifyAuthOptions> = {}): VerifyAuthOptions {
  return {
    expectedNonce: NONCE,
    expectedAudience: AUDIENCE,
    expectedOrigin: ORIGIN,
    resolverUrl: 'https://resolver.example',
    ...over,
  }
}

function stubResolver(didDocument: Record<string, unknown> | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: didDocument !== null, json: async () => ({ didDocument }) }) as Response),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('verifyAuth (SOC-28)', () => {
  it('authenticates a correctly signed, bound, fresh response', async () => {
    const { response, didDocument } = await makeSignedResponse()
    stubResolver(didDocument)

    const result = await verifyAuth(response, options())

    expect(result.errors).toEqual([])
    expect(result.authenticated).toBe(true)
    expect(result.did).toBe(DID)
  })

  it('rejects a forged response that was never signed (approved:true only)', async () => {
    stubResolver({ id: 'did:victim', authentication: [] })
    const forged: AuthResponse = { approved: true, did: 'did:victim' }

    const result = await verifyAuth(forged, options())

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('MISSING_FIELDS')
  })

  it('rejects a tampered signature', async () => {
    const { response, didDocument } = await makeSignedResponse({ tamperSignature: true })
    stubResolver(didDocument)

    const result = await verifyAuth(response, options())

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('SIGNATURE_INVALID')
  })

  it('rejects a signature made over a different nonce (replay)', async () => {
    const { response, didDocument } = await makeSignedResponse({ nonce: 'a-different-nonce' })
    stubResolver(didDocument)

    const result = await verifyAuth(response, options({ expectedNonce: NONCE }))

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('NONCE_MISMATCH')
  })

  it('rejects a response for a different audience/origin', async () => {
    const { response, didDocument } = await makeSignedResponse({ audience: 'https://other.example', origin: 'https://other.example' })
    stubResolver(didDocument)

    const result = await verifyAuth(response, options())

    expect(result.authenticated).toBe(false)
    const codes = result.errors.map((e) => e.code)
    // Both checks must fire — signed over a different audience AND origin.
    expect(codes).toContain('AUDIENCE_MISMATCH')
    expect(codes).toContain('ORIGIN_MISMATCH')
  })

  it('rejects a stale response beyond the freshness window', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const { response, didDocument } = await makeSignedResponse({ timestamp: old })
    stubResolver(didDocument)

    const result = await verifyAuth(response, options({ maxAgeSeconds: 300 }))

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('STALE')
  })

  it('rejects when the signing key is not in the DID Document authentication relationship', async () => {
    const { response } = await makeSignedResponse()
    // Resolver returns a doc whose authentication does NOT contain the signing key.
    stubResolver({ id: DID, verificationMethod: [], authentication: [] })

    const result = await verifyAuth(response, options())

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('KEY_NOT_IN_AUTHENTICATION')
  })

  it('fails closed when expected nonce/audience/origin are blank', async () => {
    const { response, didDocument } = await makeSignedResponse()
    stubResolver(didDocument)

    const result = await verifyAuth(response, options({ expectedNonce: '' }))

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('EXPECTED_PARAMS_MISSING')
  })

  it('authenticates when the DID Document lists the key as publicKeyMultibase (H2)', async () => {
    const { response } = await makeSignedResponse()
    // Same key, expressed as Ed25519VerificationKey2020 / Multikey (publicKeyMultibase).
    const multibase = ed25519Multibase(response.publicKeyJwk as JsonWebKey)
    stubResolver({
      id: DID,
      verificationMethod: [{ id: `${DID}#k1`, type: 'Ed25519VerificationKey2020', controller: DID, publicKeyMultibase: multibase }],
      authentication: [`${DID}#k1`],
    })

    const result = await verifyAuth(response, options())

    expect(result.errors).toEqual([])
    expect(result.authenticated).toBe(true)
  })

  it('rejects a response whose fields contain an injected newline (H1)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    // Both expected and echoed nonce carry the newline so binding would "match" —
    // the canonical-safety guard must reject before that.
    const injected = 'abc\nhttps://attacker.example'
    const { response } = await makeSignedResponse({ nonce: injected })

    const result = await verifyAuth(response, options({ expectedNonce: injected }))

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('MALFORMED_FIELDS')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a DER-encoded / wrong-length signature with a clear error (H3)', async () => {
    const { response, didDocument } = await makeSignedResponse()
    stubResolver(didDocument)
    // A 70-byte DER-looking blob (leading 0x30) instead of a 64-byte raw signature.
    const der = new Uint8Array(70)
    der[0] = 0x30
    const bad = { ...response, signature: bytesToB64url(der.buffer) }

    const result = await verifyAuth(bad, options())

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('SIGNATURE_FORMAT_INVALID')
  })

  it('does not verify signatures or resolve the DID when binding fails (H4)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { response } = await makeSignedResponse({ nonce: 'wrong-nonce' })

    const result = await verifyAuth(response, options({ expectedNonce: NONCE }))

    expect(result.authenticated).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('NONCE_MISMATCH')
    expect(fetchSpy).not.toHaveBeenCalled() // no resolver round-trip for a mismatched response
  })

  it('rejects a replayed nonce via the isNonceUsed hook, accepts a fresh one (C1)', async () => {
    const { response, didDocument } = await makeSignedResponse()
    stubResolver(didDocument)

    const replayed = await verifyAuth(response, options({ isNonceUsed: () => true }))
    expect(replayed.authenticated).toBe(false)
    expect(replayed.errors.map((e) => e.code)).toContain('NONCE_REPLAYED')

    stubResolver(didDocument)
    const fresh = await verifyAuth(response, options({ isNonceUsed: () => false }))
    expect(fresh.authenticated).toBe(true)
  })
})
