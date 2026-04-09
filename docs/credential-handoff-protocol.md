# Open Credential Handoff Fragment Protocol

**Version:** 1
**Status:** Draft
**Editor:** Attestto, on behalf of any issuer who wants to hand a Verifiable Credential to a holder via a URL.
**License:** Apache 2.0
**Reference implementation:** <https://verify.attestto.com/offer/>
**Source:** <https://github.com/Attestto-com/verify>
**Helper library:** [`@attestto/id-wallet-adapter`](https://github.com/Attestto-com/id-wallet-adapter) — `serializeCredentialOffer()` / `parseCredentialOffer()`

## 1. Goal

Let any issuer hand a [W3C Verifiable Credential](https://www.w3.org/TR/vc-data-model/) to any holder via a URL — no servers, no APIs, no accounts, no integration — and let any compatible wallet receive it on a generic landing page.

The protocol is **content-blind**: it does not care what kind of credential is being handed off, what DID method the issuer uses, what proof format the credential carries, or what wallet the holder runs. It only standardizes how the payload is encoded into a URL.

## 2. Design constraints

| Constraint | Why |
|---|---|
| Static-page friendly | The receiving page must work on any static host (GitHub Pages, S3, IPFS, a single HTML file). No backend, no APIs. |
| Zero server leakage | The credential payload MUST NOT reach any server log on the way from issuer to holder. |
| Single URL | The whole offer must fit in a URL the issuer can email, paste, QR-encode, or share via SMS. |
| Sanitized teaser | The page must be able to render a recognizable teaser BEFORE talking to any wallet. |
| Forward-compatible failure | Wallets and pages built before a future version bump must reject the offer loudly, not silently. |
| Issuer-neutral | Nothing about the wire format depends on a specific issuer, vendor, or trust framework. |

## 3. Wire format

A credential offer is a URL fragment of the form:

```
#v=1&vc=<base64url>&preview=<base64url>
```

Appended to any landing page URL, e.g.

```
https://verify.attestto.com/offer/#v=1&vc=eyJhbGc...&preview=eyJ0eXBl...
https://your-issuer.example/credential-receive#v=1&vc=eyJhbGc...&preview=eyJ0eXBl...
file:///path/to/local/offer.html#v=1&vc=eyJhbGc...&preview=eyJ0eXBl...
```

### 3.1 Why a URL fragment

The portion of a URL after `#` is **never** transmitted to the server. Browsers parse it, JavaScript on the loaded page can read it via `location.hash`, but it does not appear in:

- Server access logs (Apache, Nginx, GitHub Pages, S3, Cloudflare, …)
- Referrer headers (most modern browsers strip the fragment from `Referer:`)
- CDN edge logs

The credential payload travels from the holder's clipboard, email, or QR scanner directly into the page's JavaScript runtime, with no intermediate server seeing it.

### 3.2 Parameters

| Parameter | Required | Encoding | Description |
|---|---|---|---|
| `v` | yes | unsigned integer | Protocol version. Current: `1`. Pages and wallets MUST reject unknown values. |
| `vc` | yes | base64url(UTF-8) | The full Verifiable Credential payload. JWT-VC compact form is preferred (smaller, signed). JSON-LD VC is accepted. The page treats this as opaque and hands it to the wallet without parsing. |
| `preview` | yes | base64url(UTF-8 JSON) | Sanitized teaser fields for the page to render before talking to a wallet. **MUST NOT contain PII.** See §4. |

`base64url` is the URL-safe variant of base64 defined in [RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648#section-5): `+` → `-`, `/` → `_`, no padding.

### 3.3 Example fragment

```
#v=1&vc=ZXlKaGJHY2lPaUpGWkVSVFFTSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKa2FXUTZkMlZpT21GMGRHVnpkSFJ2TG1OdmJTSjkuZmFrZXNpZ2Zha2VzaWc&preview=eyJ0eXBlIjoiQ8OpZHVsYSBkZSBJZGVudGlkYWQiLCJpc3N1ZXIiOiJBdHRlc3R0byBQbGF0Zm9ybSIsImxldmVsIjoiTml2ZWwgQiIsImlzc3VlZEF0IjoiMjAyNi0wNC0wOFQwMDowMDowMFoiLCJpY29uIjoi4piFIn0
```

When parsed:

```json
{
  "v": 1,
  "vc": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOmF0dGVzdHRvLmNvbSJ9.fakesigfakesig",
  "preview": {
    "type": "Cédula de Identidad",
    "issuer": "Attestto Platform",
    "level": "Nivel B",
    "issuedAt": "2026-04-08T00:00:00Z",
    "icon": "★"
  }
}
```

## 4. Preview field — privacy contract

The `preview` object exists so the landing page can render a recognizable card BEFORE the holder authorizes anything. It is also the **only** place in the wire format with a strict privacy contract.

### 4.1 Required fields

| Field | Type | Constraint |
|---|---|---|
| `type` | string | Credential type label in the user's display language. Non-empty. e.g. `"Cédula de Identidad"`, `"Bachelor of Science"`, `"Medical Fitness Certificate"`. |
| `issuer` | string | Human-readable issuer name. Non-empty. e.g. `"Attestto Platform"`, `"Universidad de Costa Rica"`. **NOT the issuer DID.** |

### 4.2 Optional fields

| Field | Type | Constraint |
|---|---|---|
| `level` | string | Legal tier or trust level label, if applicable. e.g. `"Nivel B"`, `"Nivel A+"`, `"Verified"`, `"Self-asserted"`. |
| `issuedAt` | string | ISO 8601 UTC timestamp. e.g. `"2026-04-08T00:00:00Z"`. |
| `icon` | string | Single emoji or short string for the teaser visual. e.g. `"★"`, `"🎓"`, `"🩺"`. |

### 4.3 Forbidden in `preview` (privacy hard rules)

The following MUST NEVER appear in the `preview` object, even if the underlying credential contains them:

- Holder name (given, family, or display)
- Government ID number (cédula, SSN, passport, tax ID, …)
- Date of birth, place of birth, nationality
- Address, phone number, email
- Photo, signature image, or any biometric data
- Holder DID
- Issuer DID (use the human name in `issuer` instead)
- Any other identifier that ties this credential to a specific person

The issuer is **solely responsible** for this filtering. The landing page renders whatever it gets — there is no second line of defense. Wallet receivers MAY warn the user if they detect PII-shaped fields in the preview, but compliant pages do not enforce this.

Why this is strict: a preview travels in URLs that are emailed, pasted into chats, screenshotted, indexed by search engines if posted publicly, and saved in browser histories. Anything in `preview` should be considered as public as the URL itself.

### 4.4 What goes in `vc` instead

The full credential payload — including any of the fields forbidden in `preview` — lives in `vc`. The page never decodes it. It is handed to the wallet via the wallet's own credential offer / push protocol, which may ask the holder for explicit consent before storing it. The credential's own selective-disclosure mechanism (BBS+, SD-JWT, etc.) governs what the holder later reveals to verifiers.

## 5. Versioning

The `v=` parameter is the entire forward-compatibility surface. Rules:

1. Pages and wallets MUST check `v` first.
2. If `v` is missing, the page MUST surface an error to the user, not attempt fallback parsing.
3. If `v` is present but unrecognized, the page MUST surface a clear "this offer was created by a newer issuer than this page understands" error.
4. New protocol versions MAY rename, add, or remove parameters. They MAY change the encoding.
5. New protocol versions MUST NOT silently change the meaning of an existing parameter name.

## 6. Reference implementation

### 6.1 Issuer side

```ts
import { serializeCredentialOffer } from '@attestto/id-wallet-adapter'

const fragment = serializeCredentialOffer({
  vc: jwtVc, // your signed JWT-VC or JSON-LD VC
  preview: {
    type: 'Cédula de Identidad',
    issuer: 'Attestto Platform',
    level: 'Nivel B',
    issuedAt: new Date().toISOString(),
    icon: '★',
  },
})

const url = `https://verify.attestto.com/offer/${fragment}`
// Hand `url` to the holder via email, QR, SMS, etc.
```

### 6.2 Receiving page side

```ts
import { parseCredentialOffer } from '@attestto/id-wallet-adapter'

const result = parseCredentialOffer(window.location.hash)

if (!result.ok) {
  showError(result.error.code, result.error.message)
  return
}

renderTeaser(result.offer.preview)
const wallets = await discoverWallets()
if (wallets.length === 0) {
  showInstallHint()
  return
}
await pushCredentialToWallet(wallets[0], result.offer.vc)
```

## 7. Security considerations

### 7.1 Threat model summary

A bad actor can control the URL a victim clicks. They control the `vc=` payload, the `preview=` payload, the channel that delivers the URL, and the framing in which it is shared. The page that receives the URL has **no way to validate the issuer claim before the wallet runs**, by design — the page is content-blind.

Six attack scenarios were considered when v1 was drafted:

| # | Severity | Scenario |
|---|---|---|
| 1 | 🔴 | **Confidence-trick phishing via attacker-controlled teaser**. The `preview` says "issuer: Tribunal Supremo de Elecciones", the page renders that label inside trusted chrome, the user assumes the page validated it. |
| 2 | 🟠 | **Malicious VC payload** (XSS in claim values, parser DoS, JSON-LD context SSRF, prototype pollution). |
| 3 | 🟠 | **Spoofed wallet via discovery protocol** — a malicious extension registers itself with a familiar name and icon. |
| 4 | 🟡 | **VC targeted at a specific wallet vulnerability**. The page is the delivery vector but the bug is in the wallet. |
| 5 | 🟡 | **Iframe / cross-site silent push** — already mitigated by requiring an explicit user click and the wallet's own consent prompt. |
| 6 | 🟢 | **XSS via preview rendered as innerHTML** — already mitigated; reference impl renders every preview field via `textContent`. |

### 7.2 Hard rules — page MUST

1. **The page is a trust boundary**. Source-available pages with reproducible builds are strongly preferred. The reference page at `verify.attestto.com/offer/` is open source under Apache 2.0.
2. **The page MUST render preview fields via safe text APIs only** (e.g. `textContent` in DOM, never `innerHTML`, never templating that auto-decodes HTML entities).
3. **The page MUST surface a clearly visible "this preview is unverified" warning** above the rendered preview, in user-facing language, before any action button. The user's mental model must be: *the page is a transport, the wallet is the verifier*.
4. **The page MUST require an explicit user gesture** (click, key press) to push the credential to a wallet. Auto-push on page load is forbidden.
5. **The page SHOULD use a two-step confirm flow** for the push action: a first interaction that reveals "what is going to happen" details, followed by a second, distinct interaction that actually triggers the push. This is not a hard MUST because some low-risk flows (e.g. a hospital giving a patient a vaccination record after in-person verification) may justify a one-click experience.
6. **The page MUST NOT add analytics or telemetry that captures any portion of the URL fragment**. The reference implementation captures none.
7. **The page SHOULD surface a provenance hint** (e.g. `document.referrer` host, or an explicit "origin unknown" label) so the user can sanity-check the source.
8. **The page MUST NOT render a picker of uninstalled wallets** (the *no-picker rule*). `discoverWallets()` returns only wallets that announced themselves at runtime; the page renders that result faithfully — one, two, however many the user actually has installed. Pages MUST NOT advertise additional wallets the user does not have, MUST NOT hard-code a list of "supported wallets" beyond the discovery result, and MUST NOT present the discovery result as a brand catalog.

   The antipattern this rule rejects is the wallet-picker dialog common in some Web3 ecosystems — a scrollable list of 10–20 wallet brands shown regardless of installation state, with a "Less options" affordance to hide the long tail. That pattern is hostile on three axes simultaneously:

   - **User-hostile** — induces decision fatigue and trains the user to perceive identity as a vendor-shopping problem rather than a credential-presentation problem.
   - **Project-hostile** — concentrates surface area on whichever projects pay for top placement in the picker, recreating the lock-in the open protocol was meant to avoid.
   - **Team-hostile** — raises the bar for any new wallet team to become "visible" enough to be added to the canonical picker list, even though the protocol itself is permissionless.

   The no-picker rule keeps the protocol **team-friendly** (any team can ship a wallet that plugs in without asking permission), **project-friendly** (no project gets preferential placement on landing pages), and **user-friendly** (the user sees exactly what they actually have, never more, never less).

### 7.3 Hard rules — wallet MUST

The page hands the VC to the wallet via the wallet's own credential offer / push protocol (postMessage, browser API, native intent, etc.). What the wallet does with that VC is the trust gate of the entire protocol. Wallets compliant with this spec MUST:

1. **Verify the issuer signature** against the issuer's published DID document (or other resolution mechanism appropriate to the credential format) before storing the credential. Wallets that store offered credentials without signature verification are **non-compliant** with this spec.
2. **Check revocation** if the credential supports it (status list, RevReg, etc.).
3. **Show the user the verified issuer name and key** (resolved from the DID document, **not** the value of `preview.issuer`) when asking for storage consent.
4. **Show the user the verified credential type and claims** (extracted from the VC, **not** from `preview`) when asking for storage consent.
5. **Treat the `preview` as untrusted hint metadata only** — it is acceptable to display it for orientation, but it MUST NOT be presented as if it had been validated.
6. **Refuse to store unsigned, malformed, or invalid VCs** without negotiation. Surfacing the failure to the user is acceptable; silent storage is not.
7. **Sanitize all VC claim string values as untrusted user input** when rendering them in the wallet UI later.
8. **Not auto-present the offered credential to verifiers without user consent** — a stored credential is not an authorization to present it.

### 7.4 Other considerations

1. **The fragment lives in browser history**. A holder who clicks an offer URL on a shared device leaves that URL in history. Issuers handing high-value credentials should consider one-time URLs (rotate the encoded VC after first use, e.g. by re-issuing).
2. **The fragment is not encrypted to the holder**. Anyone with the URL can hand the credential to a wallet. Confidentiality of the URL is the issuer-to-holder channel's responsibility (signed email, end-to-end encrypted chat, in-person QR, etc.).
3. **The preview is public**. Treat it as you would treat the subject line of an unencrypted email. See §4.3.
4. **Wallet announcement spoofing** in the discovery protocol is a known gap as of v1. The current `discoverWallets()` flow does not require wallets to sign their announcement payload, so a malicious extension can register with a familiar name and icon. Mitigation is being designed for v0.5 of `@attestto/id-wallet-adapter` and is not part of the current credential-handoff protocol surface. Until then, holders must rely on having installed a trusted wallet from a trusted source.

## 8. Privacy considerations

1. **Zero server reach**. By construction, no server in the path between issuer and holder sees the VC payload.
2. **Holder anonymity to the page**. The page never learns who the holder is. The wallet handshake is the only point at which any identity is exchanged, and that handshake happens entirely on the holder's device.
3. **No telemetry by default**. Pages SHOULD NOT add analytics that capture any portion of the URL fragment. Reference implementations MUST NOT.

## 9. Self-hosting the reference page

The reference receiving page is under 1KB of HTML and ~5KB of JavaScript (gzipped). To run your own copy:

1. Fork [`Attestto-com/verify`](https://github.com/Attestto-com/verify).
2. Replace the brand assets in `c/index.html` and `public/`.
3. `pnpm install && pnpm vite build --config vite.config.pages.ts`.
4. Deploy `dist-pages/c/` (or `dist-pages/offer/` once aliased) to any static host.

The fragment protocol is identical regardless of where the page is hosted. A holder who clicks `https://attestto.org/offer/#v=1&...` and one who clicks `https://your-foundation.example/offer/#v=1&...` go through the same flow with the same code.

## 10. Open issues for v2 (non-binding)

- Selective-disclosure preview hints (let issuers signal which fields can be partially redacted in presentations later).
- Wallet recommendation hints (let issuers say "this credential is best loaded into a wallet that supports BBS+", without enforcing).
- Multi-credential offers (currently one fragment = one credential; v2 may support batch offers).
- Localized previews (a `previews` array, one per BCP-47 language tag, instead of a single `preview` object).

These are deliberately out of scope for v1 to keep the protocol shippable today.

## 11. Acknowledgements

This protocol borrows shape from CHAPI (`web` credential type), OID4VCI Credential Offer URIs, and W3C Verifiable Credentials. It is intentionally smaller than any of them — it solves only the URL-handoff problem and leaves verification, presentation, and revocation to existing standards.

---

Comments and pull requests welcome at <https://github.com/Attestto-com/id-wallet-adapter>.
