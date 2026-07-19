# Changelog

All notable changes to `@attestto/id-wallet-adapter` will be documented in this file.

This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-06-25

### Added
- **DID-based authentication flow** — new `requestAuth(wallet, request)` for login use cases. Mirrors `requestSignature` but with `{ nonce, audience, origin }` semantics instead of document hash. Exports: `requestAuth`, `RequestAuthOptions`, `AuthRequest`, `AuthResponse`, `AuthDetail`, `AuthResponseDetail`, `AUTH_EVENT`, `AUTH_RESPONSE_EVENT`.
- **`trustedIssuers?: string[]` field** on `SignRequest` and `AuthRequest`. The verifier declares which issuer DIDs it will accept; the wallet uses this to filter and highlight the user's matching identities so the user doesn't sign with an identity the verifier would reject. Empty/omitted = wallet shows all identities.
- 7 new tests covering the auth round-trip, timeout, envelope-nonce isolation, and `trustedIssuers` protocol passthrough on both request types (now 103 tests total).

### Notes
- Additive only — no breaking changes. Wallet implementations that ignore `trustedIssuers` continue to work; sites that don't set it get the previous behavior (wallet shows all identities).

## [0.4.1] - 2026-04-15

### Added
- Test suite: 96 tests covering credential offer protocol (22), compliance policy matcher (48), and wallet event flow (26: discovery, registration, signing).
- npm badge and attestto.org backlinks in README.

### Fixed
- Apache 2.0 LICENSE + NOTICE file, package.json license field consistency.

## [0.4.0] - 2026-04-12

### Added
- **Open Credential Handoff Fragment Protocol v1:** `serializeCredentialOffer()` and `parseCredentialOffer()` for URL-fragment-based credential offers. No PII in URLs — preview fields are public-safe only.
- Full threat model documentation for credential handoff (§7).
- No-picker rule: credential offers bypass wallet picker entirely (§7.2 #8).

## [0.3.0] - 2026-04-08

### Added
- **Compliance policy matching:** `matchPolicy()` pure function for wallet-side enforcement. AND/OR semantics, field constraints (=, !=, >, >=, <, <=, in, notIn, exists), dotted paths, array credentialSubject support.
- `requestSignature()` — nonce-based document signing protocol with timeout and consent flow.
- `pickWallet()` three-tier API: headless, default modal (dark theme, responsive), or custom renderer.
- QR fallback for mobile wallets when no extensions found.
- Goal codes in `WalletAnnouncement` + `requiredGoals` filter.
- Protocol filtering (`requiredProtocols`) in wallet picker.

### Fixed
- Wallet trust bypass: require wallet param, fail closed when `trustedWallets` is set.
- picomatch ReDoS vulnerability (dependency update).

## [0.2.0] - 2026-03-28

### Changed
- **Breaking:** Renamed to `@attestto/id-wallet-adapter` (from `@attestto/identity-bridge`).

### Added
- `discoverWallets()` — nonce-based browser event discovery of credential wallet extensions.
- `registerWallet()` — wallet-side registration for content scripts.
- `verifyPresentation()` — VP validation with DID resolution, signature verification, issuer trust checks.

## [0.1.0] - 2026-03-20

### Added
- Initial release as `@attestto/identity-bridge`.
- Basic wallet discovery and verification primitives.
