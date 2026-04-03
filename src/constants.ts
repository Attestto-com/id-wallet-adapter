/** Dispatched by the site to trigger wallet discovery */
export const DISCOVER_EVENT = 'credential-wallet:discover'

/** Dispatched by each wallet extension in response */
export const ANNOUNCE_EVENT = 'credential-wallet:announce'

/** Dispatched by the site to request a document signature */
export const SIGN_EVENT = 'credential-wallet:sign'

/** Dispatched by the wallet extension with the signature result */
export const SIGN_RESPONSE_EVENT = 'credential-wallet:sign-response'
