/**
 * Credential Wallet Connector — Type definitions
 *
 * Defines the data structures for the universal wallet discovery protocol.
 */

// ---------------------------------------------------------------------------
// Wallet identity
// ---------------------------------------------------------------------------

/** A wallet's self-description, broadcast during discovery */
export interface WalletAnnouncement {
  /** The wallet's own DID — eats its own dog food */
  did: string
  /** Human-readable wallet name */
  name: string
  /** Wallet icon URL (SVG or PNG, ideally 64x64) */
  icon: string
  /** Semantic version */
  version: string
  /** Supported credential protocols */
  protocols: WalletProtocol[]
  /** Capability goals this wallet can handle (Aries RFC 0519 inspired) */
  goals?: string[]
  /** Who maintains this wallet */
  maintainer: WalletMaintainer
  /** Homepage or docs URL */
  url?: string
}

/** Credential exchange protocols a wallet may support */
export type WalletProtocol = 'chapi' | 'didcomm-v2' | 'oid4vp' | 'waci-didcomm'

/** Organization or individual maintaining a wallet */
export interface WalletMaintainer {
  /** Organization or individual name */
  name: string
  /** Maintainer's DID */
  did?: string
  /** Website */
  url?: string
}

// ---------------------------------------------------------------------------
// Event detail types
// ---------------------------------------------------------------------------

/** Payload of the discover event (site → wallets) */
export interface DiscoverDetail {
  /** Nonce to correlate discover → announce */
  nonce: string
}

/** Payload of the announce event (wallet → site) */
export interface AnnounceDetail {
  /** Correlates to the discover nonce */
  nonce: string
  /** The wallet's self-description */
  wallet: WalletAnnouncement
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** What the site wants signed */
export interface SignRequest {
  /** Content hash (hex) to sign */
  hash: string
  /** Human-readable document name (shown in consent popup) */
  fileName: string
  /** Hash algorithm used (e.g. 'SHA-256') */
  hashAlgorithm: string
  /** Optional file size in bytes (for display) */
  fileSize?: number
}

/** What the wallet returns after user consents */
export interface SignResponse {
  /** Whether the user approved the signature */
  approved: boolean
  /** Signer's DID (present when approved) */
  did?: string
  /** Base64url-encoded signature value (present when approved) */
  signature?: string
  /** Signer's public key in JWK format (present when approved) */
  publicKeyJwk?: JsonWebKey
  /** ISO 8601 timestamp of signature creation (present when approved) */
  timestamp?: string
}

/** Payload of the sign event (site → wallet) */
export interface SignDetail {
  /** Nonce to correlate request → response */
  nonce: string
  /** DID of the target wallet */
  walletDid: string
  /** The signing request */
  request: SignRequest
}

/** Payload of the sign-response event (wallet → site) */
export interface SignResponseDetail {
  /** Correlates to the sign nonce */
  nonce: string
  /** The signing result */
  response: SignResponse
}
