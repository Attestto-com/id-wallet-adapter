# @attestto/id-wallet-adapter

[![npm version](https://img.shields.io/npm/v/@attestto/id-wallet-adapter.svg)](https://www.npmjs.com/package/@attestto/id-wallet-adapter)

Part of the [Attestto](https://attestto.org) identity infrastructure. [Documentation](https://attestto.org/docs)

> Discovery and verification layer for credential wallet browser extensions — like EIP-6963 but for W3C identity wallets.

**What's new in v0.5.0** (2026-06-25) — DID-based authentication (`requestAuth`) + `trustedIssuers` filter on sign/auth requests + new "Trust model" section below. Additive, no breaking changes. See [CHANGELOG.md](./CHANGELOG.md).

A website needs to verify a user's identity — KYC status, a university degree, a vLEI credential from GLEIF, a government-issued ID. The user has a credential wallet (browser extension or mobile app) that holds these credentials. This package handles discovery (which wallet does the user have), requests (ask for a Verifiable Presentation with selective disclosure), and verification (validate the cryptographic proof chain).

## Architecture

```mermaid
flowchart LR
    A["App / Site"] --> B["id-wallet-adapter"]
    B -->|discoverWallets| C["Extensions in MAIN world"]
    B -->|registerWallet| D["Wallet Extension A"]
    B -->|registerWallet| E["Wallet Extension B"]
    B -->|registerWallet| F["Wallet Extension C"]
    D --> G["User's DIDs"]
    E --> G
    F --> G
    G -->|verifyPresentation| H["Trust Chain<br/>DID resolution<br/>Signature verification<br/>Issuer trust<br/>Revocation check"]
    
    style A fill:#1a1a2e,stroke:#7c3aed,color:#e0e0e0
    style B fill:#1a1a2e,stroke:#10b981,color:#e0e0e0
    style H fill:#1a1a2e,stroke:#06b6d4,color:#e0e0e0
```

The identity space has wire protocols (OID4VP, DIDComm v2) that define how credentials move between wallets and sites. But before those conversations can happen, you need a discovery layer. **id-wallet-adapter is that discovery layer.** Without it, sites hardcode detection for every wallet ("Connect with Wallet X" buttons) — the NASCAR problem. EIP-6963 solved this for Ethereum wallets. id-wallet-adapter solves it for identity wallets.

### Why this matters

For any regulated use case — FATF Travel Rule, eIDAS 2.0, AML compliance — you need cryptographic proof that a trusted issuer attested something about a person. A password or an OAuth token won't cut it. Verifiable Credentials are the standard. This package is the discovery and verification layer that connects the site to the user's credential wallet.

### Where this fits in the ecosystem

The identity space has wire protocols (how credentials move) and discovery protocols (how you find the wallet). Most projects focus on the wire. We focus on the discovery.

**Wire protocols** define the conversation:

| Protocol | What it does | Limitation |
|---|---|---|
| [OID4VP](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) | VP exchange via OAuth 2.0 flows, QR codes, deep links | Assumes you already know the wallet. No browser extension discovery. |
| [DIDComm v2](https://identity.foundation/didcomm-messaging/spec/) | Encrypted peer-to-peer messaging between agents | Designed for server/mobile agents, not browser extensions. |
| [WACI-DIDComm](https://identity.foundation/wallet-and-credential-interactions/) | Challenge-response credential exchange via QR/deep links | Defines the exchange flow, not wallet discovery. Assumes wallet is already known. |
| [W3C CHAPI](https://chapi.io/) | Browser mediator for `navigator.credentials` | Central mediator dependency. No late-arrival handling. No custom UI. |

**Discovery protocols** find who to talk to:

| Protocol | What it does | Limitation |
|---|---|---|
| [W3C Digital Credentials API](https://w3c-fedid.github.io/digital-credentials/) | Routes to OS wallets (Apple Wallet, Google Wallet) | No browser extension discovery. |
| [DIF Wallet Rendering](https://identity.foundation/wallet-rendering/) | Standardizes how credentials look (icons, colors, labels) | Not about discovery — complementary. |
| [Aries RFC 0031](https://identity.foundation/aries-rfcs/latest/features/0031-discover-features/) | Agent-to-agent feature/protocol negotiation via query/disclose messages | Runtime negotiation between connected agents. Not browser discovery. |
| [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) | Multi-provider discovery for Ethereum wallets | Ethereum-only. Not for identity wallets. |
| **id-wallet-adapter** | Discovers browser extension credential wallets, provides interactive picker with late-arrival support | Browser-first. Mobile deep links are out of scope (OID4VP handles that). |

**id-wallet-adapter is the application-layer discovery that triggers wire protocols.** It doesn't replace OID4VP or DIDComm — it finds the wallet, then the site uses whatever wire protocol it needs.

Think of it like DNS vs HTTP. OID4VP is the conversation. We're the lookup.

### The NASCAR problem

Without a discovery protocol, sites end up with a wall of "Connect with [Wallet X]" buttons — the [NASCAR problem](https://indieweb.org/NASCAR_problem). EIP-6963 solved this for Ethereum. id-wallet-adapter solves it for identity wallets.

```ts
// Before: hardcode every wallet
if (window.attesttoId) { /* ... */ }
if (window.credible) { /* ... */ }
if (window.trinsic) { /* ... */ }

// After: discover all, let the user pick
const wallet = await pickWallet()
```

## Quick start

### Prerequisites

- Node.js 16+
- Browser with support for `CustomEvent` (all modern browsers)
- Credential wallet browser extension installed (optional for initial testing)

### Install

```bash
npm install @attestto/id-wallet-adapter
```

### Try it

#### Three tiers of usage

```ts
import { discoverWallets, pickWallet, verifyPresentation } from '@attestto/id-wallet-adapter'

// ── Tier 1: Headless — build your own UI ──────────────────
const wallets = await discoverWallets()
// You render however you want

// ── Tier 2: Default modal — zero config, vanilla JS ───────
const wallet = await pickWallet()
// Built-in modal, framework-agnostic, works everywhere

// ── Tier 3: Custom renderer — bring your own UI ───────────
const wallet = await pickWallet({
  render: (onSelect, onCancel) => ({
    update: (wallets) => { /* re-render your list */ },
    destroy: () => { /* cleanup DOM */ },
  })
})
```

Late-arriving wallets are pushed to the renderer via `update()` — no stale lists.

### Full example (Tier 2 + verification)

```ts
import { pickWallet, verifyPresentation } from '@attestto/id-wallet-adapter'

// 1. User picks a wallet from the built-in modal
const wallet = await pickWallet()
if (!wallet) return // user cancelled

// 2. Request a credential via standard CHAPI
const credential = await navigator.credentials.get({
  web: {
    VerifiablePresentation: {
      query: { type: 'DIDAuthentication' },
      challenge: crypto.randomUUID(),
      domain: window.location.origin,
    },
  },
})

// 3. Verify the returned VP cryptographically
const result = await verifyPresentation(credential, wallet, {
  resolverUrl: 'https://your-backend.com/api/resolver',
  trustedIssuers: ['did:web:attestto.com'],
})

if (result.valid) {
  console.log('Verified holder:', result.holderDid)
} else {
  console.error('Verification failed:', result.errors)
}
```

### Wallet-side (your browser extension)

```ts
import { registerWallet } from '@attestto/id-wallet-adapter'

// Call once in your content script (MAIN world)
registerWallet({
  did: 'did:web:yourorg.com:wallets:your-wallet',
  name: 'Your Wallet',
  icon: 'https://yourorg.com/icon-64.svg',
  version: '1.0.0',
  protocols: ['chapi', 'didcomm-v2'],
  goals: ['verify-identity', 'issue-credential', 'present-proof'],
  maintainer: {
    name: 'Your Org',
    did: 'did:web:yourorg.com',
    url: 'https://yourorg.com',
  },
})
```

## API

### `discoverWallets(timeoutMs?: number): Promise<WalletAnnouncement[]>`

Discover all credential wallet extensions. Dispatches a discover event and collects announcements within the timeout window (default 800ms).

### `registerWallet(wallet: WalletAnnouncement): void`

Register your wallet extension to respond to discovery events. Call once in your content script's MAIN world.

### `pickWallet(options?): Promise<WalletAnnouncement | null>`

Interactive wallet picker with three usage tiers. Returns the selected wallet, or `null` if cancelled / no wallets found.

```ts
// Default modal — zero config
const wallet = await pickWallet()

// Filter by protocol — only show OID4VP-capable wallets
const wallet = await pickWallet({ requiredProtocols: ['oid4vp'] })

// Filter by goal — only wallets that handle government IDs
const wallet = await pickWallet({ requiredGoals: ['verify-identity'] })

// Custom renderer — bring your own UI
const wallet = await pickWallet({
  render: (onSelect, onCancel) => ({
    update: (wallets) => { /* called on each new wallet discovery */ },
    destroy: () => { /* cleanup */ },
  })
})

// QR fallback — show QR code when no browser extensions found
const wallet = await pickWallet({
  qrFallback: {
    url: 'https://your-backend.com/oid4vp/request/abc123',
    label: 'Scan with your mobile wallet',
  }
})
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `timeoutMs` | `number` | `2000` | How long to wait for wallet announcements |
| `requiredProtocols` | `WalletProtocol[]` | `[]` | Only show wallets supporting all listed protocols |
| `requiredGoals` | `string[]` | `[]` | Only show wallets supporting all listed goal codes |
| `qrFallback` | `QrFallbackOptions` | — | QR code shown when no extensions found (see below) |
| `render` | `function` | built-in modal | Custom render function (see below) |

**QR fallback options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | (required) | URL encoded in the QR code (e.g. OID4VP request URI) |
| `label` | `string` | `"Scan with mobile wallet"` | Text shown below the QR code |
| `onResponse` | `function` | — | Called when your backend signals the mobile wallet responded |

When no browser extension wallets are discovered within the timeout, the default modal switches from "Discovering wallets..." to the QR code. If a late-arriving extension announces after the QR is shown, the modal updates to show both.

**Custom renderer contract:**

```ts
interface PickerRenderer {
  update: (wallets: WalletAnnouncement[]) => void  // Called on each new discovery
  destroy: () => void                                // Called to tear down UI
}
```

**Late-arriving wallets:** Browser extensions inject content scripts at `document_start`, but some take a few extra milliseconds. If the picker modal is already open and a new wallet announces itself, `update()` fires with the full cumulative list — the UI adds the new wallet in real-time instead of showing a stale list. No reload needed.

### `verifyPresentation(vp, wallet, options): Promise<VerifyResult>`

Verify a Verifiable Presentation returned by a credential wallet. Performs the full trust chain:

1. **Wallet trust check** — is this wallet in your trusted wallets list?
2. **Holder extraction** — extract the holder DID from the VP
3. **DID resolution** — resolve the holder's DID Document from your resolver
4. **Signature verification** — verify the VP signature against the DID Document
5. **Issuer trust check** — are all VC issuers in your trusted issuers list?
6. **Revocation check** — query each VC's Bitstring Status List for revocation

```ts
const result = await verifyPresentation(vp, wallet, {
  resolverUrl: 'https://your-backend.com/api/resolver',  // DID resolver endpoint (required)
  trustedIssuers: ['did:web:attestto.com'],               // Trusted VC issuers (required)
  trustedWallets: ['did:web:attestto.com:wallets:attestto-creds'], // Optional wallet allowlist
  checkRevocation: true,                                   // Check Bitstring Status List (default true)
  signal: abortController.signal,                          // Optional AbortSignal
})
```

**Returns:**

```ts
interface VerifyResult {
  valid: boolean                         // true if zero errors
  holderDid: string | null               // The holder's DID extracted from the VP
  errors: VerifyError[]                  // All verification failures
  didDocument: Record<string, unknown> | null  // Resolved DID Document
}

interface VerifyError {
  code: VerifyErrorCode                  // Machine-readable error code
  message: string                        // Human-readable description
}

// Package-defined error codes — use these to handle failures programmatically
type VerifyErrorCode =
  | 'NO_HOLDER'           // VP has no holder DID
  | 'RESOLUTION_FAILED'   // Could not resolve the holder's DID
  | 'SIGNATURE_INVALID'   // VP signature verification failed
  | 'ISSUER_UNTRUSTED'    // VC issuer not in trustedIssuers list
  | 'CREDENTIAL_REVOKED'  // VC revoked via Bitstring Status List
  | 'WALLET_UNTRUSTED'    // Wallet DID not in trustedWallets list
```

These codes are defined by this package (not a W3C or DIF standard). They map to the six verification steps. The `message` field provides human-readable context for logging or UI display.

### `WalletAnnouncement`

```ts
interface WalletAnnouncement {
  did: string              // Wallet's own DID
  name: string             // Human-readable name
  icon: string             // Icon URL (SVG or PNG, 64x64)
  version: string          // Semantic version
  protocols: WalletProtocol[]  // Supported protocols
  goals?: string[]             // Capability goal codes (Aries RFC 0519)
  maintainer: WalletMaintainer
  url?: string             // Homepage / docs
}

type WalletProtocol = 'chapi' | 'didcomm-v2' | 'oid4vp' | 'waci-didcomm'

interface WalletMaintainer {
  name: string
  did?: string
  url?: string
}
```

### `requestSignature(wallet, request, options?): Promise<SignResponse | null>`

Request a document signature from a specific wallet. The wallet extension receives the request, shows a consent popup, and responds with the DID signature. Returns `null` if the user rejects or the timeout elapses.

```ts
import { discoverWallets, requestSignature } from '@attestto/id-wallet-adapter'

const [wallet] = await discoverWallets()
const result = await requestSignature(wallet, {
  hash: 'abc123...',           // SHA-256 hex
  fileName: 'contract.pdf',
  hashAlgorithm: 'SHA-256',
  fileSize: 9912,              // optional
})

if (result?.approved) {
  console.log('Signed by', result.did)
  console.log('Signature:', result.signature)
}
```

**Request:**

| Field | Type | Description |
|---|---|---|
| `hash` | `string` | Content hash (hex) to sign |
| `fileName` | `string` | Human-readable document name (shown in consent popup) |
| `hashAlgorithm` | `string` | Hash algorithm used (e.g. `'SHA-256'`) |
| `fileSize` | `number?` | Optional file size in bytes (for display) |
| `trustedIssuers` | `string[]?` | _(v0.5.0+)_ DIDs of issuers you accept. Wallet filters/highlights matching identities so users don't sign with an identity you'd reject. Omit to accept any identity. |

**Response:**

| Field | Type | Description |
|---|---|---|
| `approved` | `boolean` | Whether the user approved the signature |
| `did` | `string?` | Signer's DID (present when approved) |
| `signature` | `string?` | Base64url-encoded signature value |
| `publicKeyJwk` | `JsonWebKey?` | Signer's public key in JWK format |
| `timestamp` | `string?` | ISO 8601 timestamp of signature creation |

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `timeoutMs` | `number` | `120000` | How long to wait for the wallet to respond |

**Protocol:** Uses the same nonce-based CustomEvent pattern as discovery:
1. Site dispatches `credential-wallet:sign` with nonce + request
2. Wallet extension shows consent popup
3. Wallet responds with `credential-wallet:sign-response` + nonce + result

### `requestAuth(wallet, request, options?): Promise<UnverifiedAuthResponse | null>`

_(v0.5.0+)_ DID-based authentication — the "Sign in with Attestto" primitive. The wallet proves control of an identity DID against a site-issued nonce. Mirrors `requestSignature` but with login semantics (`nonce` + `audience` + `origin`) instead of a document hash. Returns `null` if the user rejects or the timeout elapses.

> **SECURITY (v0.7.0+):** the result arrives over a page `window` event that any script can forge, so `approved`/`did` are **not** proof of authentication. You **must** pass the result to [`verifyAuth`](#verifyauthresponse-options-promiseauthverifyresult) and trust only `authenticated === true`.

```ts
import { discoverWallets, requestAuth, verifyAuth } from '@attestto/id-wallet-adapter'

const [wallet] = await discoverWallets()
const nonce = crypto.randomUUID()
const audience = window.location.origin
const origin = window.location.origin

const result = await requestAuth(wallet, { nonce, audience, origin })
if (result) {
  const verified = await verifyAuth(result, {
    expectedNonce: nonce,
    expectedAudience: audience,
    expectedOrigin: origin,
    resolverUrl: 'https://resolver.attestto.org',
  })
  if (verified.authenticated) {
    console.log('Signed in as', verified.did) // only trustworthy after verifyAuth
  } else {
    console.warn('Auth rejected:', verified.errors)
  }
}
```

### `verifyAuth(response, options): Promise<AuthVerifyResult>`

_(v0.7.0+)_ The mandatory verifier for `requestAuth`. Fail-closed, it (1) verifies the signature over the canonical payload (`canonicalAuthMessage`, version `attestto-did-auth-v1`) with zero-dependency WebCrypto (Ed25519 / ES256), (2) resolves the DID and confirms the signing key is in the DID Document's `authentication` relationship, and (3) checks nonce/audience/origin binding + freshness (`maxAgeSeconds`, default 300). Returns `{ authenticated, did, errors }`.

**Request:**

| Field | Type | Description |
|---|---|---|
| `nonce` | `string` | Server-generated single-use challenge — verify it matches what you issued |
| `audience` | `string` | Your verifier identifier (typically your URL or DID) — wallet signs over this |
| `origin` | `string` | Page origin (typically `window.location.origin`) |
| `trustedIssuers` | `string[]?` | DIDs of issuers you accept. Wallet uses this to filter and highlight matching identities so the user doesn't sign in with an identity you'd reject. Omit to accept any identity. |

**Response:** same shape as `requestSignature` (`approved`, `did`, `signature`, `publicKeyJwk`, `timestamp`).

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `timeoutMs` | `number` | `120000` | How long to wait for the wallet to respond |

**Protocol:** nonce-based CustomEvent pattern:
1. Site dispatches `credential-wallet:auth` with nonce + request
2. Wallet shows consent popup (user picks identity if multiple, filtered by `trustedIssuers`)
3. Wallet responds with `credential-wallet:auth-response` + nonce + result

**Backend verification:** verify the returned signature against the public key in the holder's DID Document. If you set `trustedIssuers`, also verify that an issuer in your list attested the identity.

### Event Constants

```ts
import {
  DISCOVER_EVENT,         // 'credential-wallet:discover'
  ANNOUNCE_EVENT,         // 'credential-wallet:announce'
  SIGN_EVENT,             // 'credential-wallet:sign'
  SIGN_RESPONSE_EVENT,    // 'credential-wallet:sign-response'
  AUTH_EVENT,             // 'credential-wallet:auth'              (v0.5.0+)
  AUTH_RESPONSE_EVENT,    // 'credential-wallet:auth-response'     (v0.5.0+)
} from '@attestto/id-wallet-adapter'
```

## Writing a Custom Wallet Integration

Follow these steps to make your browser extension discoverable via this protocol.

### Step 1 — Install and register

Add the package to your extension and call `registerWallet()` in a content script that runs in the page's **MAIN** world (not the isolated extension world).

```ts
// content-script.ts (MAIN world)
import { registerWallet } from '@attestto/id-wallet-adapter'

registerWallet({
  did: 'did:web:yourorg.com:wallets:your-wallet',
  name: 'Your Wallet',
  icon: 'https://yourorg.com/icon-64.svg',
  version: '1.0.0',
  protocols: ['chapi'],
  maintainer: { name: 'Your Org', did: 'did:web:yourorg.com' },
})
```

Your `did` field must be a real, resolvable DID. The protocol eats its own dog food — wallets identify themselves the same way users do.

### Step 2 — Handle CHAPI requests

Override `navigator.credentials.get()` in the MAIN world to intercept credential requests:

```ts
const originalGet = navigator.credentials.get.bind(navigator.credentials)

navigator.credentials.get = async function (options) {
  // Check if this is a VP request
  const vpRequest = (options as any)?.web?.VerifiablePresentation
  if (!vpRequest) return originalGet(options)

  // Show your consent UI to the user
  const userConsented = await showConsentDialog(vpRequest)
  if (!userConsented) throw new DOMException('User denied', 'NotAllowedError')

  // Build and return the VP
  return buildVerifiablePresentation(vpRequest)
}
```

### Step 3 — Return a Verifiable Presentation

The VP you return must include:

- **`holder`** — the user's DID (string or `{ id: 'did:...' }`)
- **`verifiableCredential`** — array of VCs
- **`proof`** — cryptographic signature over the VP

```ts
function buildVerifiablePresentation(request) {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiablePresentation'],
    holder: 'did:web:user.example.com',
    verifiableCredential: [/* user's selected VCs */],
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      challenge: request.challenge,
      domain: request.domain,
      verificationMethod: 'did:web:user.example.com#key-1',
      proofValue: '...',  // Sign with the user's private key
    },
  }
}
```

### Step 4 — Handle signing requests

Listen for `credential-wallet:sign` events and respond with the signature:

```ts
// content-script.ts (MAIN world)
window.addEventListener('credential-wallet:sign', async (e) => {
  const { nonce, walletDid, request } = e.detail
  if (walletDid !== YOUR_WALLET_DID) return

  // Show consent popup to the user
  const approved = await showSignConsent(request.fileName, request.hash)

  // Sign and respond
  const signature = approved ? await signWithUserKey(request.hash) : null
  window.dispatchEvent(new CustomEvent('credential-wallet:sign-response', {
    detail: {
      nonce,
      response: {
        approved,
        did: approved ? userDid : undefined,
        signature: approved ? signature : undefined,
        timestamp: approved ? new Date().toISOString() : undefined,
      }
    }
  }))
})
```

### Step 5 — Verify your DID is resolvable

The site will verify your VP by resolving the holder's DID and checking the signature against the public key in the DID Document. Make sure:

- The holder's DID resolves to a valid DID Document
- The DID Document contains the public key referenced in `proof.verificationMethod`
- The `proof.challenge` and `proof.domain` match what the site sent

## Supported Protocols

<table>
<tr>
<th width="160">Protocol</th>
<th>Description</th>
</tr>
<tr>
<td><code>chapi</code></td>
<td>W3C Credential Handler API — <code>navigator.credentials.get()</code></td>
</tr>
<tr>
<td><code>didcomm-v2</code></td>
<td>DIDComm v2 Present Proof 3.0</td>
</tr>
<tr>
<td><code>oid4vp</code></td>
<td>OpenID for Verifiable Presentations</td>
</tr>
<tr>
<td><code>waci-didcomm</code></td>
<td>Wallet And Credential Interaction via DIDComm</td>
</tr>
</table>

## Ecosystem

Related repos in the Attestto ecosystem:

| Package | Purpose | Repo |
|---|---|---|
| **@attestto/wallet-identity-resolver** | Given a wallet address, resolve all DIDs, credentials, SBTs attached to it | [GitHub](https://github.com/Attestto-com/wallet-identity-resolver) |
| **@attestto/verify** | Web Components for wallet discovery, signing, and VP verification | [GitHub](https://github.com/Attestto-com/verify) |
| **@attestto/vc-sdk** | Issue and verify W3C Verifiable Credentials | [GitHub](https://github.com/Attestto-com/vc-sdk) |
| **did-sns-spec** | `did:sns` DID method spec — Solana domain to DID resolution | [GitHub](https://github.com/Attestto-com/did-sns-spec) |
| **vLEI-Solana-Bridge** | Write and verify vLEI attestations from GLEIF on Solana | [GitHub](https://github.com/Attestto-com/vLEI-Solana-Bridge) |

## Security

See [SECURITY.md](SECURITY.md) for:

- **Wallet discovery spoofing** — discovery is untrusted metadata; trust is established via VP verification
- **Trusted wallet allowlist** — restrict which wallet DIDs your app accepts
- **Cross-origin considerations** — CORS for DID resolution and revocation checks
- **API key exposure** — always use a backend proxy for resolver calls
- **Trust chain** — the DID method spec defines where to resolve, not the VC

## Trust model (for site developers)

This package implements a **bilateral trust model**. Each side declares what it accepts; neither side is asked to trust the other implicitly.

### Site → wallet: declare which issuers you accept

Pass `trustedIssuers: string[]` on any `requestSignature` or `requestAuth` call:

```ts
await requestAuth(wallet, {
  nonce, audience, origin,
  trustedIssuers: [
    'did:sns:attestto.attestto.sol',  // any identity issued by Attestto root
    'did:web:your-tenant.example',    // OR identities issued by your own tenant
  ],
})
```

The wallet uses this to filter and highlight matching identities in the consent popup. If the user has multiple identities, they default-see the one your site will actually accept — no "user signs, server rejects, user retries" loop.

**Empty / omitted** → the wallet shows all the user's identities; you accept whatever they return (verify on the backend).

### Wallet → site: per-origin consent and identity memory

These are wallet-side properties — your site doesn't configure them, but you should know they exist so you understand the UX:

- **First-sight consent** — the first time your origin requests a sign-in or pushes an identity-sync payload, the wallet asks the user to approve your origin. Subsequent requests from the same origin proceed without re-prompting. This means a site that's never been visited cannot silently get an identity signature.
- **Per-origin identity preference** — when the user picks an identity for your origin, the wallet remembers it. Next time you call `requestAuth`, the wallet default-selects the same identity. The user can override per-call.
- **User-visible revocation** — the user can revoke your origin's trust (and forget the preference) from the wallet's Settings → Trusted Sites pane.

### Backend verification responsibility

The adapter never trusts a `requestAuth` / `requestSignature` response on its own. Always verify on your backend:

1. The returned `signature` is valid over `nonce + audience + origin` using the `publicKeyJwk` from the response.
2. The `publicKeyJwk` matches a verification method published in the holder DID's DID Document (resolve via your resolver).
3. If you set `trustedIssuers`: an issuer in your list actually attested the returned `did` (look for a corresponding VC chain, OR trust the wallet's filtering and skip — depending on your assurance level).

The `nonce` must be single-use and bound to the user's session. Replay protection is the verifier's job, not the wallet's.

## Build with an LLM

This repo ships a [`llms.txt`](./llms.txt) context file — a machine-readable summary of the API, data structures, and integration patterns designed to be read by AI coding assistants.

### Recommended setup

Use the [`attestto-dev-mcp`](../attestto-dev-mcp) server to give your LLM active access to the ecosystem:

```bash
cd ../attestto-dev-mcp
npm install && npm run build
```

Then add it to your Claude / Cursor / Windsurf config and ask:

> *"Explore the Attestto ecosystem and scaffold me an on-chain identity resolver"*

### Which model?

We recommend **[Claude](https://claude.ai) Pro** (5× usage vs free) or higher. Long context and strong TypeScript reasoning handle this codebase well. The MCP server works with any LLM that supports tool use.

> **Quick start:** Ask your LLM to read `llms.txt` in this repo, then describe what you want to build. It will find the right archetype, generate boilerplate, and walk you through the first run.

## Roadmap

### v0.3.0 — Protocol negotiation

Multi-protocol wallets declare `protocols: ['oid4vp', 'chapi', 'didcomm-v2']`. The site needs a standard way to pick the best mutual protocol and act on it.

```ts
import { pickWallet, negotiateProtocol } from '@attestto/id-wallet-adapter'

const wallet = await pickWallet()
const protocol = negotiateProtocol(wallet, ['oid4vp', 'chapi'])
// Returns 'oid4vp' if wallet supports it, falls back to 'chapi', or null
```

Inspired by [Aries RFC 0031 Discover Features](https://identity.foundation/aries-rfcs/latest/features/0031-discover-features/) — simplified for browser context.

### v0.4.0 — Protocol execution

`pickWallet()` returns a `ConnectedWallet` with protocol-specific request methods:

```ts
const wallet = await pickWallet()
const vp = await wallet.request('oid4vp', { presentationDefinition })
// or
const vp = await wallet.request('chapi', { query, challenge, domain })
```

One return object, multiple wire protocols. The wallet adapter becomes the unified interface between the site and whatever protocol the wallet speaks.

## See It In Action

| Demo | What | Link |
|------|------|------|
| **Verify & Sign** | Live playground with the actual components — drop a PDF, sign it | [verify.attestto.com/docs](https://verify.attestto.com/docs) |
| **@attestto/verify** | Web Components that use this adapter for wallet discovery + signing | [GitHub](https://github.com/attestto/verify) |
| **DID Landscape Explorer** | Self-assessment wizard with wallet picker and CHAPI flow | [GitHub](https://github.com/chongkan/did-landscape-explorer) |

**Debug logging:** Open the console on any page using this adapter and run `Attestto.debug = true` to see the full discovery and signing flow with numbered steps.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache 2.0](./LICENSE) — see also [`NOTICE`](./NOTICE).

This package ships with Apache 2.0's explicit patent grant (§3): every contributor grants a perpetual, worldwide, royalty-free, irrevocable patent license for their contributions, plus the §3 retaliation clause that terminates that license for anyone who weaponizes patents against the project. We chose Apache 2.0 specifically because protocol-shaped infrastructure deserves a license that says something explicit about patents. MIT does not.
