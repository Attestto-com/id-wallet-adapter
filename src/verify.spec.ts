/**
 * verifyPresentation — challenge / domain binding (replay defense, SOC-23).
 *
 * These tests exercise the binding gate, which runs BEFORE any network call,
 * so the replay-rejection cases need no resolver/fetch mock. The one happy-path
 * test stubs fetch to confirm a correctly-bound VP proceeds past the gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyPresentation, type VerifyOptions } from './verify'
import type { WalletAnnouncement } from './types'

const wallet: WalletAnnouncement = {
  did: 'did:sns:holder.attestto.sol',
  name: 'Test Wallet',
  protocols: [],
} as unknown as WalletAnnouncement

const CHALLENGE = 'a3f1c2d4-0000-4444-8888-abcdefabcdef'
const DOMAIN = 'https://relying-party.example'

function baseOptions(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  return {
    resolverUrl: 'https://resolver.example',
    trustedIssuers: ['*'],
    expectedChallenge: CHALLENGE,
    expectedDomain: DOMAIN,
    ...overrides,
  }
}

/** A minimal VP whose authentication proof binds the given challenge + domain. */
function vpWithProof(proof: Record<string, unknown>): Record<string, unknown> {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiablePresentation'],
    holder: wallet.did,
    proof,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('verifyPresentation — challenge/domain binding (SOC-23)', () => {
  it('rejects a VP whose proof carries a different domain (cross-origin replay)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: CHALLENGE,
      domain: 'https://phishing.attacker.example',
      created: new Date().toISOString(),
    })

    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('DOMAIN_MISMATCH')
    // Fail closed BEFORE any network call — never resolve/verify a foreign VP.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a VP whose proof carries a stale/foreign challenge (session replay)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: 'some-previous-session-challenge',
      domain: DOMAIN,
      created: new Date().toISOString(),
    })

    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('CHALLENGE_MISMATCH')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a VP with no proof at all', async () => {
    const vp: Record<string, unknown> = {
      type: ['VerifiablePresentation'],
      holder: wallet.did,
    }
    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('PROOF_MISSING')
  })

  it('rejects a VP whose bound proof is older than the freshness window', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago
    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: CHALLENGE,
      domain: DOMAIN,
      created: stale,
    })

    const result = await verifyPresentation(vp, wallet, baseOptions({ maxProofAgeSeconds: 300 }))

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('PROOF_EXPIRED')
  })

  it('requires challenge and domain to be bound by the SAME proof', async () => {
    // Two separate proofs, each matching only one field — must not pass.
    const vp: Record<string, unknown> = {
      type: ['VerifiablePresentation'],
      holder: wallet.did,
      proof: [
        { type: 'Ed25519Signature2020', challenge: CHALLENGE, domain: 'https://other.example' },
        { type: 'Ed25519Signature2020', challenge: 'other-challenge', domain: DOMAIN },
      ],
    }

    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails closed when the verifier supplies an empty expected challenge/domain', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: '',
      domain: '',
      created: new Date().toISOString(),
    })

    const result = await verifyPresentation(vp, wallet, baseOptions({ expectedChallenge: '', expectedDomain: '' }))

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('EXPECTED_BINDING_MISSING')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a bound proof that omits `created` (freshness cannot be skipped)', async () => {
    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: CHALLENGE,
      domain: DOMAIN,
      // no `created`
    })

    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('PROOF_EXPIRED')
  })

  it('rejects a bound proof whose `created` is unparseable', async () => {
    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: CHALLENGE,
      domain: DOMAIN,
      created: 'not-a-date',
    })

    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('PROOF_EXPIRED')
  })

  it('does not match binding on a spliced proof with blank challenge/domain', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    // Attacker appends an empty proof alongside a real (foreign-domain) one.
    const vp: Record<string, unknown> = {
      type: ['VerifiablePresentation'],
      holder: wallet.did,
      proof: [
        { type: 'Ed25519Signature2020', challenge: '', domain: '' },
        { type: 'Ed25519Signature2020', challenge: CHALLENGE, domain: 'https://attacker.example' },
      ],
    }

    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.valid).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards expectedChallenge/expectedDomain to the resolver verify endpoint', async () => {
    let verifyBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/1.0/identifiers/')) {
          return { ok: true, json: async () => ({ didDocument: { id: wallet.did } }) } as Response
        }
        if (url.includes('/1.0/verify')) {
          verifyBody = JSON.parse(String(init?.body))
          return { ok: true, json: async () => ({ valid: true }) } as Response
        }
        return { ok: false, json: async () => ({}) } as Response
      }),
    )

    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: CHALLENGE,
      domain: DOMAIN,
      created: new Date().toISOString(),
    })

    await verifyPresentation(vp, wallet, baseOptions())

    expect(verifyBody).not.toBeNull()
    expect(verifyBody!.expectedChallenge).toBe(CHALLENGE)
    expect(verifyBody!.expectedDomain).toBe(DOMAIN)
  })

  it('lets a correctly-bound, fresh VP proceed past the binding gate', async () => {
    // Binding passes → code reaches the resolver. Stub fetch so resolution +
    // signature succeed, proving the gate did not block a legitimate VP.
    const didDoc = { id: wallet.did }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/1.0/identifiers/')) {
          return { ok: true, json: async () => ({ didDocument: didDoc }) } as Response
        }
        if (url.includes('/1.0/verify')) {
          return { ok: true, json: async () => ({ valid: true }) } as Response
        }
        return { ok: false, json: async () => ({}) } as Response
      }),
    )

    const vp = vpWithProof({
      type: 'Ed25519Signature2020',
      challenge: CHALLENGE,
      domain: DOMAIN,
      created: new Date().toISOString(),
    })

    const result = await verifyPresentation(vp, wallet, baseOptions())

    expect(result.errors.map((e) => e.code)).not.toContain('DOMAIN_MISMATCH')
    expect(result.errors.map((e) => e.code)).not.toContain('CHALLENGE_MISMATCH')
    expect(result.valid).toBe(true)
    expect(result.holderDid).toBe(wallet.did)
  })
})
