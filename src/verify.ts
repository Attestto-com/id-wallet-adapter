/**
 * Presentation verification — validate a VP returned by a credential wallet.
 */

import type { WalletAnnouncement } from './types'

export interface VerifyOptions {
  resolverUrl: string
  trustedIssuers: string[]
  checkRevocation?: boolean
  trustedWallets?: string[]
  signal?: AbortSignal
}

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

export async function verifyPresentation(
  vp: Record<string, unknown>,
  wallet: WalletAnnouncement | null,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const errors: VerifyError[] = []
  let holderDid: string | null = null
  let didDocument: Record<string, unknown> | null = null

  if (options.trustedWallets && wallet) {
    if (!options.trustedWallets.includes(wallet.did)) {
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

  const sigValid = await verifySignature(vp, options.resolverUrl, options.signal)
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

async function resolveDid(did: string, resolverUrl: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${resolverUrl}/1.0/identifiers/${encodeURIComponent(did)}`, { signal })
  if (!res.ok) return null
  const data = await res.json() as { didDocument?: Record<string, unknown> }
  return data.didDocument ?? null
}

async function verifySignature(vp: Record<string, unknown>, resolverUrl: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${resolverUrl}/1.0/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verifiablePresentation: vp }),
      signal,
    })
    if (!res.ok) return false
    const data = await res.json() as { valid?: boolean }
    return data.valid === true
  } catch {
    return vp.proof !== undefined && vp.proof !== null
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
