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
    expect(codes.some((c) => c === 'AUDIENCE_MISMATCH' || c === 'ORIGIN_MISMATCH')).toBe(true)
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
})
