/**
 * Open Credential Handoff Fragment Protocol — serializer & parser.
 *
 * Lets any issuer hand a Verifiable Credential to any holder via a URL
 * fragment, with a sanitized PII-free preview, so any compatible wallet
 * can receive it on a generic landing page (e.g. verify.attestto.com/offer/).
 *
 * Why a URL fragment instead of a query string or path:
 *  - Browsers NEVER transmit the part after `#` to the server. The credential
 *    payload stays on the holder's device.
 *  - GitHub Pages, Cloudflare, server access logs all see only the path.
 *  - Browser history caches it locally — that's a holder-side concern, not
 *    a server leak.
 *
 * Why a separate preview field instead of decoding the VC client-side:
 *  1. The landing page can render the teaser without parsing the VC at all.
 *  2. Decoding a 50KB VC just to render four labels is wasteful.
 *  3. Forces the issuer to make an explicit "what is safe to put in a URL"
 *     decision per credential type. The page renders whatever it gets — there
 *     is no second line of defense against PII leaks.
 *  4. Versioning: the VC format and the teaser shape can evolve independently.
 *
 * Wire format:
 *
 *     #v=1&vc=<base64url>&preview=<base64url>
 *
 * - `v`       — protocol version (current: 1). Reject unknown versions.
 * - `vc`      — base64url-encoded full VC (JWT-VC compact form preferred,
 *               JSON-LD VC accepted as fallback). Opaque to the page.
 * - `preview` — base64url-encoded UTF-8 JSON of the teaser. NEVER PII.
 *
 * Reference implementation: https://verify.attestto.com/offer/
 * Spec doc: docs/credential-handoff-protocol.md
 */

/**
 * Sanitized teaser fields the landing page can render BEFORE talking to
 * any wallet. Hard rule: every field MUST be safe to expose in a URL that
 * the holder may share, paste, or save. NEVER include name, ID number,
 * date of birth, photo, DID, or any other identifier that ties this
 * credential to a specific person.
 */
export interface CredentialOfferPreview {
  /** Credential type label in the user's display language. e.g. "Cédula de Identidad", "Bachelor of Science" */
  type: string
  /** Human-readable issuer name (NOT the issuer DID). e.g. "Attestto Platform", "Universidad de Costa Rica" */
  issuer: string
  /** Legal tier or trust level label, if applicable. e.g. "Nivel B", "Nivel A+", "Verified" */
  level?: string
  /** ISO 8601 UTC issuance timestamp. */
  issuedAt?: string
  /** Optional single emoji or short string for the teaser visual. e.g. "★", "🎓", "🩺" */
  icon?: string
}

/**
 * The decoded form of a credential offer URL fragment, ready for the
 * landing page to consume.
 */
export interface CredentialOffer {
  /** Protocol version. Always 1 in v1. */
  version: 1
  /** Opaque VC payload. The page hands this to the wallet via the canonical push protocol — it does NOT parse it. */
  vc: string
  /** Sanitized preview the page renders without parsing the VC. */
  preview: CredentialOfferPreview
}

/**
 * The current and only protocol version. Bump this when introducing a
 * breaking change to the wire format. The parser will reject any other
 * value, ensuring forward-compatibility failures are loud and explicit.
 */
export const CREDENTIAL_OFFER_PROTOCOL_VERSION = 1 as const

/**
 * Errors the parser may surface. The page should map these to user-facing
 * messages, never expose them raw.
 */
export type CredentialOfferParseErrorCode =
  | 'NO_FRAGMENT'
  | 'MISSING_VERSION'
  | 'UNKNOWN_VERSION'
  | 'MISSING_VC'
  | 'MISSING_PREVIEW'
  | 'INVALID_PREVIEW_BASE64'
  | 'INVALID_PREVIEW_JSON'
  | 'INVALID_PREVIEW_SHAPE'

export interface CredentialOfferParseError {
  code: CredentialOfferParseErrorCode
  message: string
}

export type CredentialOfferParseResult =
  | { ok: true; offer: CredentialOffer }
  | { ok: false; error: CredentialOfferParseError }

// ── base64url helpers (URL-safe, no padding, UTF-8 round-trip) ─

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  // btoa is Latin-1 in browsers; it's safe here because we passed bytes.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  // Pad to a multiple of 4. atob accepts strings without padding in some
  // engines but rejects them in others.
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

// ── Public API ────────────────────────────────────────────────

/**
 * Serialize a Verifiable Credential and its sanitized preview into a URL
 * fragment string suitable for appending to any landing page URL.
 *
 * The returned string includes the leading `#` so it can be concatenated
 * directly with a base URL.
 *
 * @example
 * ```ts
 * import { serializeCredentialOffer } from '@attestto/id-wallet-adapter'
 *
 * const fragment = serializeCredentialOffer({
 *   vc: 'eyJhbGciOiJFZERTQSI...',
 *   preview: {
 *     type: 'Cédula de Identidad',
 *     issuer: 'Attestto Platform',
 *     level: 'Nivel B',
 *     issuedAt: '2026-04-08T00:00:00Z',
 *     icon: '★',
 *   },
 * })
 *
 * const url = `https://verify.attestto.com/offer/${fragment}`
 * // → "https://verify.attestto.com/offer/#v=1&vc=...&preview=..."
 * ```
 *
 * @returns A fragment string starting with `#`.
 */
export function serializeCredentialOffer(input: {
  vc: string
  preview: CredentialOfferPreview
}): string {
  if (!input.vc) {
    throw new Error('serializeCredentialOffer: vc is required')
  }
  if (!input.preview || typeof input.preview !== 'object') {
    throw new Error('serializeCredentialOffer: preview is required')
  }
  if (!input.preview.type || !input.preview.issuer) {
    throw new Error('serializeCredentialOffer: preview.type and preview.issuer are required')
  }

  const vcEncoded = bytesToBase64Url(utf8Encode(input.vc))
  const previewJson = JSON.stringify(input.preview)
  const previewEncoded = bytesToBase64Url(utf8Encode(previewJson))

  return `#v=${CREDENTIAL_OFFER_PROTOCOL_VERSION}&vc=${vcEncoded}&preview=${previewEncoded}`
}

/**
 * Parse a URL fragment (the part after `#`, with or without the leading
 * hash) into a CredentialOffer. Returns a discriminated union so the
 * caller can branch on success vs error without try/catch.
 *
 * Pass `window.location.hash` directly — leading `#` is stripped.
 *
 * @example
 * ```ts
 * import { parseCredentialOffer } from '@attestto/id-wallet-adapter'
 *
 * const result = parseCredentialOffer(window.location.hash)
 * if (result.ok) {
 *   renderTeaser(result.offer.preview)
 *   pushToWallet(result.offer.vc)
 * } else {
 *   showError(result.error.code)
 * }
 * ```
 */
export function parseCredentialOffer(hash: string): CredentialOfferParseResult {
  const stripped = hash.replace(/^#/, '')
  if (!stripped) {
    return err('NO_FRAGMENT', 'URL has no fragment')
  }

  const params = new URLSearchParams(stripped)
  const vRaw = params.get('v')
  const vc = params.get('vc')
  const previewRaw = params.get('preview')

  if (!vRaw) return err('MISSING_VERSION', 'Missing v= parameter')
  const version = parseInt(vRaw, 10)
  if (version !== CREDENTIAL_OFFER_PROTOCOL_VERSION) {
    return err(
      'UNKNOWN_VERSION',
      `Unsupported credential offer protocol version "${vRaw}". This page understands v=${CREDENTIAL_OFFER_PROTOCOL_VERSION}.`,
    )
  }
  if (!vc) return err('MISSING_VC', 'Missing vc= parameter')
  if (!previewRaw) return err('MISSING_PREVIEW', 'Missing preview= parameter')

  let previewJson: string
  try {
    previewJson = utf8Decode(base64UrlToBytes(previewRaw))
  } catch {
    return err('INVALID_PREVIEW_BASE64', 'preview= is not valid base64url-encoded UTF-8')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(previewJson)
  } catch {
    return err('INVALID_PREVIEW_JSON', 'preview= JSON parse failed')
  }

  if (!isPreviewShape(parsed)) {
    return err(
      'INVALID_PREVIEW_SHAPE',
      'preview= must contain at least { type, issuer } as non-empty strings',
    )
  }

  // Decode the VC payload too — it is base64url-encoded UTF-8 of the
  // JWT-VC compact form (or JSON-LD VC). The page treats it as opaque,
  // but we decode here so the caller never has to deal with base64 again.
  let vcDecoded: string
  try {
    vcDecoded = utf8Decode(base64UrlToBytes(vc))
  } catch {
    return err('MISSING_VC', 'vc= is not valid base64url-encoded UTF-8')
  }

  return {
    ok: true,
    offer: {
      version: CREDENTIAL_OFFER_PROTOCOL_VERSION,
      vc: vcDecoded,
      preview: parsed,
    },
  }
}

function err(
  code: CredentialOfferParseErrorCode,
  message: string,
): CredentialOfferParseResult {
  return { ok: false, error: { code, message } }
}

function isPreviewShape(x: unknown): x is CredentialOfferPreview {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (typeof o.type !== 'string' || o.type.length === 0) return false
  if (typeof o.issuer !== 'string' || o.issuer.length === 0) return false
  if (o.level !== undefined && typeof o.level !== 'string') return false
  if (o.issuedAt !== undefined && typeof o.issuedAt !== 'string') return false
  if (o.icon !== undefined && typeof o.icon !== 'string') return false
  return true
}
