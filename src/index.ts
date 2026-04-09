export { discoverWallets } from './discover'
export { registerWallet } from './register'
export { pickWallet } from './pick'
export { requestSignature } from './sign'
export { verifyPresentation } from './verify'
export {
  serializeCredentialOffer,
  parseCredentialOffer,
  CREDENTIAL_OFFER_PROTOCOL_VERSION,
} from './credential-offer'
export type {
  CredentialOffer,
  CredentialOfferPreview,
  CredentialOfferParseResult,
  CredentialOfferParseError,
  CredentialOfferParseErrorCode,
} from './credential-offer'
export { DISCOVER_EVENT, ANNOUNCE_EVENT, SIGN_EVENT, SIGN_RESPONSE_EVENT } from './constants'
export type {
  WalletAnnouncement,
  WalletProtocol,
  WalletMaintainer,
  DiscoverDetail,
  AnnounceDetail,
  SignRequest,
  SignResponse,
  SignDetail,
  SignResponseDetail,
} from './types'
export type {
  PickWalletOptions,
  PickerRenderer,
  QrFallbackOptions,
} from './pick'
export type {
  VerifyOptions,
  VerifyResult,
  VerifyError,
  VerifyErrorCode,
} from './verify'
export type {
  RequestSignatureOptions,
} from './sign'
