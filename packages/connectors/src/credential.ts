import type { Effect } from 'effect'

import type { ConnectorFailed } from './errors'
import type { Fetch } from './http'

/**
 * What signs Althar in to a service: an OAuth token or a pasted one, a key
 * sent as it is, a user and token, or an app's key with a token made for it.
 */
export type Credential =
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'key'; readonly token: string }
  | { readonly kind: 'basic'; readonly user: string; readonly token: string }
  | { readonly kind: 'app'; readonly key: string; readonly token: string }

/** The `Authorization` header a credential makes. */
export const authorizationOf = (credential: Credential): string => {
  switch (credential.kind) {
    case 'bearer':
      return `Bearer ${credential.token}`
    case 'key':
      return credential.token
    case 'basic':
      return `Basic ${Buffer.from(`${credential.user}:${credential.token}`).toString('base64')}`
    case 'app':
      // Trello's: in OAuth's header, so neither goes in a URL.
      return `OAuth oauth_consumer_key="${credential.key}", oauth_token="${credential.token}"`
  }
}

/** What every adapter is made from: where the service is, how to reach it, and the credential, asked for on each call. */
export interface AdapterOptions {
  readonly fetch: Fetch
  /** The API's root: `https://api.github.com`, or an instance's. */
  readonly apiUrl: string
  /** The service's own pages: `https://github.com`, or an instance's. */
  readonly webUrl: string
  readonly credential: Effect.Effect<Credential, ConnectorFailed>
}
