import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'

import { type ConnectionInfo, Connections } from '../Connections'
import { Queries } from '../Queries'
import type { ApiKit } from './kit'

/**
 * Connections to code hosts and trackers: listing them, signing in, a pasted token, the CLI, checking and disconnecting.
 * What connecting a service starts from, and finding which product answers at an address.
 */
export const connectionsHandlers = ({ actorId, api }: ApiKit) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const connections = yield* Connections
    const connectionOf = (info: ConnectionInfo) => ({
      id: info.id,
      product: info.product,
      name: info.name,
      webUrl: info.webUrl,
      account: { login: info.account.login, name: info.account.name },
      auth: info.auth,
      state: info.state,
      workspace: info.workspace,
    })
    return {
      ListConnections: () =>
        api(
          Effect.gen(function* () {
            const cursor = yield* queries.cursor
            const list = yield* connections.list
            return {
              cursor,
              connections: list.map(connectionOf),
              products: connections.products
                .filter((info) => info.make !== null)
                .map((info) => ({
                  product: info.product,
                  service: info.service,
                  name: info.name,
                  host: info.host,
                  tracker: info.tracker,
                  hostedUrl: info.hosted?.webUrl ?? null,
                  selfHosted: info.selfHosted,
                  workspaces: info.workspaces === true,
                  browserSignIn: info.browserSignIn,
                  tokenNeeds: info.token.needs,
                  tokenPrefixes: info.token.prefixes,
                  tokenHelpForKey: info.token.helpForKey ?? null,
                  keyChecks: info.token.keyChecks ?? [],
                })),
              places: yield* connections.places,
            }
          }),
        ),
      StartSignIn: ({ product, webUrl, connectionId }) =>
        api(
          connections.startSignIn({
            product,
            actorId: actorId,
            ...(webUrl === undefined ? {} : { webUrl }),
            ...(connectionId === undefined ? {} : { connectionId }),
          }),
        ),
      GetSignIn: ({ flowId }) => api(connections.signIn(flowId)),
      CancelSignIn: ({ flowId }) => api(connections.cancelSignIn(flowId)),
      ConnectToken: ({ product, webUrl, user, key, token, connectionId }) =>
        api(
          Effect.map(
            connections.connectToken({
              product,
              token,
              actorId: actorId,
              ...(webUrl === undefined ? {} : { webUrl }),
              ...(user === undefined ? {} : { user }),
              ...(key === undefined ? {} : { key }),
              ...(connectionId === undefined ? {} : { connectionId }),
            }),
            connectionOf,
          ),
        ),
      GetConnectGuide: ({ service }) => api(connections.guide(service)),
      FindServer: ({ service, webUrl }) => api(connections.findServer(service, webUrl)),
      ConnectCli: ({ product, webUrl, connectionId }) =>
        api(
          Effect.map(
            connections.connectCli({
              product,
              webUrl,
              actorId: actorId,
              ...(connectionId === undefined ? {} : { connectionId }),
            }),
            connectionOf,
          ),
        ),
      CheckConnection: ({ connectionId }) => api(connections.check(connectionId)),
      Disconnect: ({ connectionId }) => api(connections.remove(connectionId, actorId)),
    } satisfies Partial<ApiHandlers>
  })
