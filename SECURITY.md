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

If any step fails, reject the presentation. A spoofed wallet can announce a fake
DID but cannot forge a signature that matches the real DID Document's public key.

### Trusted Wallet Allowlist

For additional safety, filter discovered wallets against an allowlist:

```ts
const TRUSTED_WALLETS = [
  'did:web:attestto.com:wallets:attestto-creds',
  'did:web:spruceid.com:wallets:credible',
]
const wallets = await discoverWallets()
const trusted = wallets.filter(w => TRUSTED_WALLETS.includes(w.did))
```

## Cross-Origin Considerations

- **Discovery events** use `CustomEvent` on `window` — same-origin only, no CORS
- **CHAPI calls** (`navigator.credentials.get`) are browser-mediated — no CORS
- **Verification** (DID resolution, revocation checks) requires network calls —
  these ARE subject to CORS. Use your own backend proxy to avoid CORS issues
  and to keep API keys server-side

## API Key Exposure

**Never pass API keys in URLs from browser code.** URLs are visible in the
browser's network tab, console, and extension devtools.

```ts
// BAD — key exposed in browser
sns({ apiUrl: 'https://rpc.helius.xyz/?api-key=SECRET' })

// GOOD — proxy holds the key
sns({ apiUrl: 'https://api.yourapp.com/sns-proxy' })
```

## Credential Verification Chain of Trust

The DID method specification defines where to resolve — not the VC itself.
A VC should never contain its own resolver address, as this would create
circular trust (a malicious VC could point to a fake resolver).

```
Wallet announces DID  →  Consumer resolves DID via method spec
                         (did:web → domain, did:sns → Solana chain)
                      →  DID Document contains public key
                      →  Verify VP signature against public key
                      →  Check VC issuer is trusted
                      →  Check revocation status
```

## Reporting Vulnerabilities

Report security issues to security@attestto.com or open a private advisory
on the GitHub repository.
