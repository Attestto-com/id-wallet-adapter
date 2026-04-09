/**
 * Tests for the Open Credential Handoff Fragment Protocol serializer & parser.
 *
 * Coverage targets (per repo CLAUDE.md):
 *   - Round-trip with ASCII-only payloads
 *   - Round-trip with UTF-8 multibyte payloads (Cédula, 学位, etc.)
 *   - Every field of CredentialOfferPreview present and absent
 *   - Every error code surfaced by the parser
 *   - Strict version rejection
 *   - PII discipline note: nothing in this file emits or asserts on PII;
 *     the discipline lives in the issuer code, the parser is content-blind.
 */

import { describe, it, expect } from 'vitest'
import {
  serializeCredentialOffer,
  parseCredentialOffer,
  CREDENTIAL_OFFER_PROTOCOL_VERSION,
  type CredentialOffer,
  type CredentialOfferPreview,
} from './credential-offer'

const SAMPLE_VC_JWT =
  'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOmF0dGVzdHRvLmNvbSJ9.fakesigfakesig'

const SAMPLE_PREVIEW: CredentialOfferPreview = {
  type: 'Cédula de Identidad',
  issuer: 'Attestto Platform',
  level: 'Nivel B',
  issuedAt: '2026-04-08T00:00:00Z',
  icon: '★',
}

describe('serializeCredentialOffer', () => {
  it('returns a string starting with #', () => {
    const out = serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview: SAMPLE_PREVIEW })
    expect(out.startsWith('#')).toBe(true)
  })

  it('encodes the protocol version', () => {
    const out = serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview: SAMPLE_PREVIEW })
    expect(out).toContain(`v=${CREDENTIAL_OFFER_PROTOCOL_VERSION}`)
  })

  it('encodes both vc and preview as base64url (no +, /, =)', () => {
    const out = serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview: SAMPLE_PREVIEW })
    const params = new URLSearchParams(out.replace(/^#/, ''))
    const vcParam = params.get('vc')!
    const previewParam = params.get('preview')!
    expect(vcParam).not.toMatch(/[+/=]/)
    expect(previewParam).not.toMatch(/[+/=]/)
  })

  it('throws when vc is missing', () => {
    expect(() =>
      serializeCredentialOffer({ vc: '', preview: SAMPLE_PREVIEW }),
    ).toThrow(/vc is required/)
  })

  it('throws when preview is missing', () => {
    expect(() =>
      // @ts-expect-error — intentionally invalid
      serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview: undefined }),
    ).toThrow(/preview is required/)
  })

  it('throws when preview.type is missing', () => {
    expect(() =>
      serializeCredentialOffer({
        vc: SAMPLE_VC_JWT,
        preview: { type: '', issuer: 'X' } as CredentialOfferPreview,
      }),
    ).toThrow(/preview\.type and preview\.issuer/)
  })

  it('throws when preview.issuer is missing', () => {
    expect(() =>
      serializeCredentialOffer({
        vc: SAMPLE_VC_JWT,
        preview: { type: 'X', issuer: '' } as CredentialOfferPreview,
      }),
    ).toThrow(/preview\.type and preview\.issuer/)
  })
})

describe('parseCredentialOffer', () => {
  it('round-trips a full offer (ASCII vc, UTF-8 preview)', () => {
    const fragment = serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview: SAMPLE_PREVIEW })
    const result = parseCredentialOffer(fragment)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const offer: CredentialOffer = result.offer
    expect(offer.version).toBe(CREDENTIAL_OFFER_PROTOCOL_VERSION)
    expect(offer.vc).toBe(SAMPLE_VC_JWT)
    expect(offer.preview).toEqual(SAMPLE_PREVIEW)
  })

  it('round-trips multibyte UTF-8 in preview (Cédula, 学位, العربية)', () => {
    const preview: CredentialOfferPreview = {
      type: 'Cédula de Identidad · 学位 · العربية',
      issuer: 'Universidad de Costa Rica',
      level: 'Nivel A+',
      icon: '🎓',
    }
    const fragment = serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview })
    const result = parseCredentialOffer(fragment)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.offer.preview).toEqual(preview)
  })

  it('round-trips multibyte UTF-8 in vc payload', () => {
    // VC bodies are usually JWT (ASCII) but JSON-LD VCs may be UTF-8.
    const vc = JSON.stringify({ name: 'Cédula', issuer: '学位' })
    const fragment = serializeCredentialOffer({ vc, preview: SAMPLE_PREVIEW })
    const result = parseCredentialOffer(fragment)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.offer.vc).toBe(vc)
  })

  it('accepts a minimal preview (only type + issuer)', () => {
    const preview: CredentialOfferPreview = { type: 'Test', issuer: 'Tester' }
    const fragment = serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview })
    const result = parseCredentialOffer(fragment)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.offer.preview.level).toBeUndefined()
    expect(result.offer.preview.issuedAt).toBeUndefined()
    expect(result.offer.preview.icon).toBeUndefined()
  })

  it('strips the leading # if present', () => {
    const fragment = serializeCredentialOffer({ vc: SAMPLE_VC_JWT, preview: SAMPLE_PREVIEW })
    expect(fragment.startsWith('#')).toBe(true)
    const withHash = parseCredentialOffer(fragment)
    const withoutHash = parseCredentialOffer(fragment.replace(/^#/, ''))
    expect(withHash.ok).toBe(true)
    expect(withoutHash.ok).toBe(true)
  })

  // ── Error paths ──────────────────────────────────────────

  it('NO_FRAGMENT — empty input', () => {
    const result = parseCredentialOffer('')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NO_FRAGMENT')
  })

  it('NO_FRAGMENT — only the # character', () => {
    const result = parseCredentialOffer('#')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NO_FRAGMENT')
  })

  it('MISSING_VERSION — fragment without v=', () => {
    const result = parseCredentialOffer('#vc=abc&preview=def')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MISSING_VERSION')
  })

  it('UNKNOWN_VERSION — v=2 from a future format', () => {
    const result = parseCredentialOffer('#v=2&vc=abc&preview=def')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNKNOWN_VERSION')
    expect(result.error.message).toContain('v=1')
  })

  it('UNKNOWN_VERSION — non-numeric version', () => {
    const result = parseCredentialOffer('#v=abc&vc=x&preview=y')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNKNOWN_VERSION')
  })

  it('MISSING_VC — fragment without vc=', () => {
    const result = parseCredentialOffer('#v=1&preview=abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MISSING_VC')
  })

  it('MISSING_PREVIEW — fragment without preview=', () => {
    const result = parseCredentialOffer('#v=1&vc=abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MISSING_PREVIEW')
  })

  it('INVALID_PREVIEW_JSON — preview= is base64url but not valid JSON', () => {
    // base64url("not-json")
    const notJson = 'bm90LWpzb24'
    const result = parseCredentialOffer(`#v=1&vc=YWJj&preview=${notJson}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_PREVIEW_JSON')
  })

  it('INVALID_PREVIEW_SHAPE — preview JSON missing required fields', () => {
    // base64url('{"type":"","issuer":""}')
    const shape = btoa('{"type":"","issuer":""}')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const result = parseCredentialOffer(`#v=1&vc=YWJj&preview=${shape}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_PREVIEW_SHAPE')
  })

  it('INVALID_PREVIEW_SHAPE — preview JSON of wrong type', () => {
    // base64url('"just a string"')
    const shape = btoa('"just a string"')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const result = parseCredentialOffer(`#v=1&vc=YWJj&preview=${shape}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_PREVIEW_SHAPE')
  })
})
