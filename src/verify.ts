/**
 * Presentation verification — validate a VP returned by a credential wallet.
 */

import type { WalletAnnouncement } from './types'

export interface VerifyOptions {
  resolverUrl: string
  trustedIssuers: string[]
  /**
   * The challenge the verifier generated for THIS request (e.g. the value passed
   * as `challenge` to the CHAPI `navigator.credentials.get` call). Required: a VP
   * whose authentication proof was not made over this exact challenge is rejected.
   * This is the primary replay defense — do not omit it.
   */
  expectedChallenge: string
  /**
   * The verifier's own origin/audience (e.g. `window.location.origin`). Required:
   * a VP bound to a different domain is rejected, blocking cross-origin replay of a
   * presentation captured or minted for another site.
   */
  expectedDomain: string
  /**
   * Maximum age, in seconds, for the bound proof's `created` timestamp when present.
   * A proof older than this (or dated in the future beyond clock skew) is rejected.
   * Defaults to 300s. Set higher only with a documented reason.
   */
  maxProofAgeSeconds?: number
  /**
   * Single-use enforcement. Binding + freshness stop cross-origin and stale replays,
   * but not re-submission of a captured VP within the freshness window. Provide this
   * hook to consult your own seen-challenge store: return `true` if `challenge` was
   * already accepted. When true the VP is rejected (`CHALLENGE_REPLAYED`). Mark the
   * challenge used only after a successful verification. Without this hook, the relying
   * party is responsible for never verifying the same issued challenge twice.
   */
  isChallengeUsed?: (challenge: string) => boolean | Promise<boolean>
  checkRevocation?: boolean
  trustedWallets?: string[]
  signal?: AbortSignal
}

/** Tolerance, in seconds, for a proof `created` timestamp dated in the future (clock skew). */
const FUTURE_SKEW_TOLERANCE_SECONDS = 60

export interface VerifyResult {
  valid: boolean
  holderDid: string | null
  errors: VerifyError[]
  didDocument: Record<string, unknown> | null
}

export interface VerifyError {
  code: VerifyErrorCode
  message: string
}

export type VerifyErrorCode =
  | 'NO_HOLDER'
  | 'RESOLUTION_FAILED'
  | 'SIGNATURE_INVALID'
  | 'ISSUER_UNTRUSTED'
  | 'CREDENTIAL_REVOKED'
  | 'WALLET_UNTRUSTED'
  | 'PROOF_MISSING'
  | 'CHALLENGE_MISMATCH'
  | 'DOMAIN_MISMATCH'
  | 'PROOF_EXPIRED'
  | 'EXPECTED_BINDING_MISSING'
  | 'CHALLENGE_REPLAYED'

export async function verifyPresentation(
  vp: Record<string, unknown>,
  wallet: WalletAnnouncement,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const errors: VerifyError[] = []
  let holderDid: string | null = null
  let didDocument: Record<string, unknown> | null = null

  // Replay / audience binding is the first gate. A VP whose authentication proof
  // was not made over the verifier's own challenge AND domain is rejected here,
  // BEFORE any network call — we never resolve, verify, or fetch anything on
  // behalf of a presentation that could have been captured or minted elsewhere.
  const bindingErrors = validateBinding(vp, options)
  if (bindingErrors.length > 0) {
    return { valid: false, holderDid: extractHolder(vp), errors: bindingErrors, didDocument: null }
  }

  if (options.trustedWallets) {
    if (!wallet) {
      errors.push({ code: 'WALLET_UNTRUSTED', message: 'No wallet provided but trustedWallets is configured' })
    } else if (!options.trustedWallets.includes(wallet.did)) {
      errors.push({ code: 'WALLET_UNTRUSTED', message: `Wallet ${wallet.did} not trusted` })
    }
  }

  holderDid = extractHolder(vp)
  if (!holderDid) {
    errors.push({ code: 'NO_HOLDER', message: 'VP has no holder DID' })
    return { valid: false, holderDid: null, errors, didDocument: null }
  }

  try {
    didDocument = await resolveDid(holderDid, options.resolverUrl, options.signal)
  } catch {
    errors.push({ code: 'RESOLUTION_FAILED', message: `Could not resolve ${holderDid}` })
    return { valid: false, holderDid, errors, didDocument: null }
  }
  if (!didDocument) {
    errors.push({ code: 'RESOLUTION_FAILED', message: `No DID Document for ${holderDid}` })
    return { valid: false, holderDid, errors, didDocument: null }
  }

  const sigValid = await verifySignature(vp, options)
  if (!sigValid) {
    errors.push({ code: 'SIGNATURE_INVALID', message: 'VP signature invalid' })
  }

  for (const vc of extractCredentials(vp)) {
    const issuer = extractIssuer(vc)
    if (issuer && !options.trustedIssuers.includes(issuer)) {
      errors.push({ code: 'ISSUER_UNTRUSTED', message: `Issuer ${issuer} not trusted` })
    }
  }

  if (options.checkRevocation !== false) {
    for (const vc of extractCredentials(vp)) {
      if (await checkRevocation(vc, options.signal)) {
        errors.push({ code: 'CREDENTIAL_REVOKED', message: 'Credential revoked' })
      }
    }
  }

  // Single-use: only after the VP is otherwise valid, consult the caller's seen-challenge
  // store (if provided) so a captured-but-fresh VP cannot be replayed within the window.
  if (errors.length === 0 && options.isChallengeUsed && (await options.isChallengeUsed(options.expectedChallenge))) {
    errors.push({ code: 'CHALLENGE_REPLAYED', message: 'Challenge has already been used (replay)' })
  }

  return { valid: errors.length === 0, holderDid, errors, didDocument }
}

function extractHolder(vp: Record<string, unknown>): string | null {
  const h = vp.holder
  if (typeof h === 'string' && h.startsWith('did:')) return h
  if (typeof h === 'object' && h !== null && 'id' in h) {
    const id = (h as { id: unknown }).id
    if (typeof id === 'string' && id.startsWith('did:')) return id
  }
  return null
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** A VP may carry a single proof object or an array of proofs. Normalize to an array. */
function extractProofs(vp: Record<string, unknown>): Record<string, unknown>[] {
  const p = vp.proof
  if (Array.isArray(p)) return p.filter((x) => typeof x === 'object' && x !== null) as Record<string, unknown>[]
  if (typeof p === 'object' && p !== null) return [p as Record<string, unknown>]
  return []
}

/**
 * Enforce that the presentation is bound to THIS verifier's challenge and domain,
 * and is fresh. Returns the list of binding errors (empty when the VP is bound).
 *
 * A single proof must carry BOTH the expected challenge and the expected domain —
 * matching each field on separate proofs does not count, since an attacker could
 * otherwise splice a foreign-domain auth proof next to a matching-domain one.
 */
function validateBinding(vp: Record<string, unknown>, options: VerifyOptions): VerifyError[] {
  // Fail closed on caller misconfiguration. A blank expected challenge or domain
  // must never authenticate anything — it would otherwise match a proof that also
  // left the field blank, turning the binding gate into a no-op.
  if (!isNonEmptyString(options.expectedChallenge) || !isNonEmptyString(options.expectedDomain)) {
    return [
      {
        code: 'EXPECTED_BINDING_MISSING',
        message: 'expectedChallenge and expectedDomain are required and must be non-empty',
      },
    ]
  }

  const proofs = extractProofs(vp)
  if (proofs.length === 0) {
    return [{ code: 'PROOF_MISSING', message: 'VP has no proof to bind challenge/domain against' }]
  }

  // A single proof must carry BOTH the expected challenge and domain, each as a
  // non-empty string. Matching each field on separate proofs — or matching a
  // blank field — does not count: an attacker could otherwise splice a
  // foreign-domain auth proof next to a matching-domain one, or bind against ''.
  const bound = proofs.find(
    (pr) =>
      isNonEmptyString(pr.challenge) &&
      isNonEmptyString(pr.domain) &&
      pr.challenge === options.expectedChallenge &&
      pr.domain === options.expectedDomain,
  )
  if (!bound) {
    const errors: VerifyError[] = []
    const challengeSomewhere = proofs.some((pr) => pr.challenge === options.expectedChallenge)
    const domainSomewhere = proofs.some((pr) => pr.domain === options.expectedDomain)
    if (!challengeSomewhere) {
      errors.push({ code: 'CHALLENGE_MISMATCH', message: 'No VP proof matches the expected challenge (replay)' })
    }
    if (!domainSomewhere) {
      errors.push({ code: 'DOMAIN_MISMATCH', message: 'No VP proof matches the expected domain (cross-origin replay)' })
    }
    if (errors.length === 0) {
      // Both fields appear, but not bound together on one non-empty proof.
      errors.push({
        code: 'CHALLENGE_MISMATCH',
        message: 'No single VP proof binds both the expected challenge and domain',
      })
    }
    return errors
  }

  // Freshness is mandatory and fail-closed. The bound proof MUST carry a parseable
  // `created` timestamp inside the window. A proof with no timestamp (or an
  // unparseable one) cannot be shown to be fresh — omitting `created` must not be
  // a way to skip replay-window enforcement, so it is rejected.
  const created = bound.created
  if (typeof created !== 'string' || Number.isNaN(Date.parse(created))) {
    return [
      { code: 'PROOF_EXPIRED', message: 'VP proof has no valid `created` timestamp; freshness cannot be established' },
    ]
  }
  const maxAge = options.maxProofAgeSeconds ?? 300
  const ageSeconds = (Date.now() - Date.parse(created)) / 1000
  if (ageSeconds > maxAge) {
    return [{ code: 'PROOF_EXPIRED', message: `VP proof is older than ${maxAge}s (replay)` }]
  }
  if (ageSeconds < -FUTURE_SKEW_TOLERANCE_SECONDS) {
    return [{ code: 'PROOF_EXPIRED', message: 'VP proof `created` timestamp is in the future' }]
  }

  return []
}

function extractCredentials(vp: Record<string, unknown>): Record<string, unknown>[] {
  const c = vp.verifiableCredential
  if (Array.isArray(c)) return c as Record<string, unknown>[]
  if (typeof c === 'object' && c !== null) return [c as Record<string, unknown>]
  return []
}

function extractIssuer(vc: Record<string, unknown>): string | null {
  const i = vc.issuer
  if (typeof i === 'string' && i.startsWith('did:')) return i
  if (typeof i === 'object' && i !== null && 'id' in i) {
    const id = (i as { id: unknown }).id
    if (typeof id === 'string' && id.startsWith('did:')) return id
  }
  return null
}

export async function resolveDid(did: string, resolverUrl: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${resolverUrl}/1.0/identifiers/${encodeURIComponent(did)}`, { signal })
  if (!res.ok) return null
  const data = await res.json() as { didDocument?: Record<string, unknown> }
  return data.didDocument ?? null
}

async function verifySignature(vp: Record<string, unknown>, options: VerifyOptions): Promise<boolean> {
  try {
    // Forward the expected challenge/domain so the resolver binds the signature
    // check to them: the proof must be cryptographically valid AND made over the
    // verifier's challenge/domain. Local metadata matching (validateBinding) alone
    // could be satisfied by an unsigned proof spliced into the `proof` array; the
    // resolver is the trust anchor that ties the signature to the bound values.
    //
    // RESOLVER CONTRACT: the resolver at {resolverUrl}/1.0/verify MUST cryptographically
    // verify the presentation proof AND confirm it was made over `expectedChallenge`
    // and `expectedDomain`. If the resolver ignores these fields, binding enforcement
    // degrades to local metadata matching only. Point resolverUrl at a resolver you
    // control or trust to honor this contract.
    const res = await fetch(`${options.resolverUrl}/1.0/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verifiablePresentation: vp,
        expectedChallenge: options.expectedChallenge,
        expectedDomain: options.expectedDomain,
      }),
      signal: options.signal,
    })
    if (!res.ok) return false
    const data = await res.json() as { valid?: boolean }
    return data.valid === true
  } catch {
    // Fail closed — if the resolver is unreachable, signature cannot be verified.
    // Never trust a VP just because it has a proof field.
    return false
  }
}

async function checkRevocation(vc: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
  const status = vc.credentialStatus as { statusListCredential?: string; statusListIndex?: string } | undefined
  if (!status?.statusListCredential) return false
  try {
    const res = await fetch(status.statusListCredential, { signal })
    if (!res.ok) return false
    const list = await res.json() as { credentialSubject?: { encodedList?: string } }
    const encoded = list.credentialSubject?.encodedList
    if (!encoded || !status.statusListIndex) return false
    const decoded = atob(encoded)
    const idx = parseInt(status.statusListIndex, 10)
    const byteIdx = Math.floor(idx / 8)
    const bitIdx = idx % 8
    if (byteIdx >= decoded.length) return false
    return (decoded.charCodeAt(byteIdx) & (1 << (7 - bitIdx))) !== 0
  } catch {
    return false
  }
}
