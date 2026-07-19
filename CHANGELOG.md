# Changelog

All notable changes to `@attestto/id-wallet-adapter` will be documented in this file.

This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-07-19

### Security
- **`verifyAuth` — the mandatory verifier for the DID-login (`requestAuth`) path (SOC-28).** `requestAuth` resolves with data from a page `window` event that any script can forge, so `approved`/`did` are **not** an authentication result. `verifyAuth(response, { expectedNonce, expectedAudience, expectedOrigin, resolverUrl, maxAgeSeconds? })` is now the trust boundary and, fail-closed, (a) verifies the signature over the canonical payload with zero-dependency WebCrypto (Ed25519 and ES256/P-256), (b) resolves the DID and confirms the signing key is in the DID Document's `authentication` relationship, and (c) checks nonce/audience/origin binding + freshness. Only `authenticated === true` proves the DID.
- The canonical signed payload is defined and exported as `canonicalAuthMessage` / `DID_AUTH_CANONICAL_VERSION` (`attestto-did-auth-v1`) — the cross-repo contract wallets must sign.
- **Hardened per code review:** (1) auth keys published as `publicKeyMultibase` (the norm for `Ed25519VerificationKey2020` / `Multikey` / did:key) are now matched, not just `publicKeyJwk`, via a zero-dep base58-btc + multicodec decode — `verifyAuth` was otherwise non-functional for most real DIDs; (2) signed fields containing control characters are rejected (`MALFORMED_FIELDS`) to prevent newline/field-shift injection in the canonical payload; (3) signatures are length/format-validated — a DER-encoded ECDSA signature (WebCrypto needs raw IEEE-P1363 r‖s) is rejected with `SIGNATURE_FORMAT_INVALID` instead of a silent failure; (4) binding/freshness failures now return **before** any signature verification or DID resolution; (5) optional `isNonceUsed` hook enforces single-use so a captured-but-fresh response cannot be replayed within the window (`NONCE_REPLAYED`).
- Error codes: `EXPECTED_PARAMS_MISSING`, `NOT_APPROVED`, `MISSING_FIELDS`, `MALFORMED_FIELDS`, `NONCE_MISMATCH`, `AUDIENCE_MISMATCH`, `ORIGIN_MISMATCH`, `STALE`, `NONCE_REPLAYED`, `UNSUPPORTED_KEY`, `SIGNATURE_FORMAT_INVALID`, `SIGNATURE_INVALID`, `RESOLUTION_FAILED`, `KEY_NOT_IN_AUTHENTICATION`.

### Added
- `AuthResponse` now echoes the signed `nonce`/`audience`/`origin` (so a binding mismatch is reported precisely), and `UnverifiedAuthResponse` (alias) documents that a raw `requestAuth` result is unverified until `verifyAuth` confirms it. `requestAuth` is retyped to return `UnverifiedAuthResponse`. README example updated to call `verifyAuth`.
- 13 auth-verify tests using a real WebCrypto Ed25519 key + stubbed resolver, incl. publicKeyMultibase binding, newline-injection rejection, DER-signature rejection, early-return-on-binding-failure, and the single-use hook (128 total).

### Notes
- Wallet counterpart is not yet implemented — `attestto-creds-extension` must sign `canonicalAuthMessage` (raw Ed25519 or IEEE-P1363 P-256 signature) for real auth responses to verify (SOC-71). The `requestSignature`/`SignResponse` path is still returned unverified (deferred follow-up). ES256 keys in a DID Document's `authentication` must be expressed as `publicKeyJwk` (P-256 `publicKeyMultibase` decoding is not yet supported).

## [0.6.0] - 2026-07-19

### Security
- **`verifyPresentation` now enforces challenge/domain binding and freshness (SOC-23).** Verifiers must pass the `expectedChallenge` and `expectedDomain` they issued at request time; a presentation whose authentication proof was not made over both — for example one captured on another origin or replayed from a prior session — is rejected. The binding gate runs **before any network call**, so a foreign or replayed VP is never resolved, verified, or fetched on the user's behalf. New error codes: `PROOF_MISSING`, `CHALLENGE_MISMATCH`, `DOMAIN_MISMATCH`, `PROOF_EXPIRED`, `EXPECTED_BINDING_MISSING`.
- **Fail closed throughout.** A single proof must bind BOTH the challenge and domain, each as a **non-empty** string (a blank/spliced proof field cannot satisfy the gate). Blank `expectedChallenge`/`expectedDomain` from the caller are rejected outright (`EXPECTED_BINDING_MISSING`).
- **Freshness is mandatory.** The bound proof must carry a parseable `created` timestamp within `maxProofAgeSeconds` (default 300s, 60s future-skew tolerance). A proof that omits `created` — or carries an unparseable one — is rejected rather than skipped, so freshness enforcement cannot be bypassed.
- **Signature is bound to the challenge/domain.** `expectedChallenge`/`expectedDomain` are forwarded to the resolver's `POST /1.0/verify`, so the trust anchor ties the cryptographic check to the bound values rather than trusting local metadata matching alone. The resolver contract (it MUST honor these fields) is documented at the call site; point `resolverUrl` at a resolver you trust.
- **Optional single-use** via `isChallengeUsed` — consult your seen-challenge store to reject re-submission of a captured-but-fresh VP within the window (`CHALLENGE_REPLAYED`). Without it, replay protection is window-only and single-use is the relying party's responsibility.

### Changed (BREAKING)
- `VerifyOptions` gains **required** `expectedChallenge: string` and `expectedDomain: string`, plus optional `maxProofAgeSeconds?: number` and `isChallengeUsed?`. Existing callers must supply the challenge/domain they generated for the request. Passing a resolver `{valid:true}` is no longer sufficient on its own.

### Added
- 12 tests covering cross-origin replay, session replay, missing/spliced/blank proof, empty caller binding, missing and unparseable freshness timestamps, resolver binding passthrough, single-use replay hook, same-proof binding, and the legitimate happy path.

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
