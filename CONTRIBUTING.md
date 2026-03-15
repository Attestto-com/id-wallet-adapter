# Contributing to credential-wallet-connector

Thanks for your interest in making credential wallet discovery a standard.

## Getting Started

```bash
git clone https://github.com/Attestto-com/credential-wallet-connector.git
cd credential-wallet-connector
npm install
npm run lint    # Type-check
npm run build   # Build ESM + CJS + declarations
```

## Project Structure

```
src/
  index.ts       — Public API barrel export
  constants.ts   — Event name constants
  types.ts       — TypeScript interfaces
  discover.ts    — Site-side: discoverWallets()
  register.ts    — Wallet-side: registerWallet()
  verify.ts      — VP verification (DID resolution, signature, issuer trust, revocation)
```

## How to Contribute

### Adding a new protocol type

1. Add the protocol string to `WalletProtocol` in `src/types.ts`
2. Document it in the README's Supported Protocols table
3. Submit a PR with a brief description of the protocol

### Improving discovery

The current discovery uses `CustomEvent` on `window`. If you have ideas for more robust discovery (e.g., `BroadcastChannel`, service worker messaging), open an issue first to discuss the tradeoffs.

### Bug fixes and improvements

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Make your changes
4. Run `npm run lint && npm run build` to verify
5. Commit and push
6. Open a PR

## See It In Action

The [DID Landscape Explorer](https://github.com/chongkan/did-landscape-explorer) uses this package in its self-assessment wizard. The Identity step discovers installed wallets and lets users pick one to present their DID.

## Design Principles

- **Zero dependencies** — this package must stay lightweight
- **Protocol-agnostic** — we define discovery, not the credential exchange itself
- **Wallet-neutral** — no wallet gets special treatment in the protocol
- **DID-native** — wallets identify themselves with DIDs, eating our own dog food

## Code Style

- TypeScript strict mode
- No runtime dependencies
- JSDoc on all public APIs
- Keep it small — this package should stay under 200 lines of source

## License

By contributing, you agree that your contributions will be licensed under MIT.
