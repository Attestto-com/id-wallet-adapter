export { discoverWallets } from './discover'
export { registerWallet } from './register'
export { verifyPresentation } from './verify'
export { DISCOVER_EVENT, ANNOUNCE_EVENT } from './constants'
export type {
  WalletAnnouncement,
  WalletProtocol,
  WalletMaintainer,
  DiscoverDetail,
  AnnounceDetail,
} from './types'
export type {
  VerifyOptions,
  VerifyResult,
  VerifyError,
  VerifyErrorCode,
} from './verify'
