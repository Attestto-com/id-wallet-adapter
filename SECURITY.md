# Security Considerations

## Wallet Discovery Spoofing

Any browser extension can respond to `credential-wallet:discover` and announce
itself as any wallet with any DID. The announcement is **untrusted metadata**.

**Mitigation:** Discovery is informational only. Trust is established in the
presentation phase — after the user picks a wallet, call `navigator.credentials.get()`
and verify the returned VP cryptographically:

1. **Resolve the holder's DID** — fetch the DID Document from the DID method's
   authoritative source (e.g., `did:web` → the domain, `did:sns` → Solana chain)
2. **Verify the VP signature** against the public key in the DID Document
3. **Check the VC issuer** — is the issuer DID in your trusted issuers list?
4. **Check revocation** — query the `credentialStatus` Bitstring Status List

### Trusted Wallet Allowlist

```ts
const TRUSTED_WALLETS = [
  'did:web:attestto.com:wallets:attestto-creds',
  'did:web:spruceid.com:wallets:credible',
]
const wallets = await discoverWallets()
const trusted = wallets.filter(w => TRUSTED_WALLETS.includes(w.did))
```

## Cross-Origin Considerations

- **Discovery events** use `CustomEvent` on `window` — same-origin, no CORS
- **CHAPI calls** (`navigator.credentials.get`) are browser-mediated — no CORS
- **Verification** (DID resolution, revocation) requires network calls subject to CORS. Use a backend proxy.

## API Key Exposure

**Never pass API keys in browser URLs.** Use a backend proxy that holds keys server-side.

## Credential Verification Trust Chain

The DID method spec defines where to resolve — not the VC. A VC must never contain its own resolver address.

## Reporting Vulnerabilities

Report to security@attestto.com or open a private GitHub advisory.
