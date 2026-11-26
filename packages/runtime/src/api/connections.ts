import { SOCKET_CODE_HOSTS, SOCKET_CODE_SERVICES, type ApiHandlers, ApiError } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { type ConnectionInfo, Connections } from '../Connections'
import { Queries } from '../Queries'
import type { ApiKit } from './kit'

/**
 * Connections to code hosts and trackers: listing them, signing in, a pasted token, the CLI, checking and disconnecting.
 * What connecting a service starts from, and finding which product answers at an address.
 */
export const connectionsHandlers = ({ identity, actorId, api }: ApiKit) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const sql = yield* SqlClient.SqlClient
    /**
     * A socket sets its home's code hosts up, never its trackers, whose links to projects stay with the person's own window:
     * a product it names, or a connection's own, must host code, and it follows and ends only the sign-ins it started.
     */
    const socketSetUp = identity.role === 'socket'
    const signInsStarted = new Set<string>()
    const notTrackers = () => new ApiError({ reason: 'PersonRequired', message: 'Connect or remove a tracker in the person’s own window.' })
    const codeHostOnly = (product: string) => (socketSetUp && !SOCKET_CODE_HOSTS.has(product) ? Effect.fail(notTrackers()) : Effect.void)
    const codeServiceOnly = (service: string) =>
      socketSetUp && !SOCKET_CODE_SERVICES.has(service) ? Effect.fail(notTrackers()) : Effect.void
    const codeHostConnection = (connectionId: string | undefined) =>
      !socketSetUp || connectionId === undefined
        ? Effect.void
        : Effect.flatMap(Effect.orDie(sql<{ product: string }>`SELECT product FROM connections WHERE id = ${connectionId}`), ([row]) =>
            row === undefined ? Effect.void : codeHostOnly(row.product),
          )
    const ownSignIn = (flowId: string) => (socketSetUp && !signInsStarted.has(flowId) ? Effect.fail(notTrackers()) : Effect.void)
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
        Effect.andThen(
          Effect.andThen(codeHostOnly(product), codeHostConnection(connectionId)),
          api(
            connections
              .startSignIn({
                product,
                actorId: actorId,
                ...(webUrl === undefined ? {} : { webUrl }),
                ...(connectionId === undefined ? {} : { connectionId }),
              })
              .pipe(Effect.tap((started) => Effect.sync(() => signInsStarted.add(started.flowId)))),
          ),
        ),
      GetSignIn: ({ flowId }) => Effect.andThen(ownSignIn(flowId), api(connections.signIn(flowId))),
      CancelSignIn: ({ flowId }) => Effect.andThen(ownSignIn(flowId), api(connections.cancelSignIn(flowId))),
      ConnectToken: ({ product, webUrl, user, key, token, connectionId }) =>
        Effect.andThen(
          Effect.andThen(codeHostOnly(product), codeHostConnection(connectionId)),
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
        ),
      GetConnectGuide: ({ service }) => Effect.andThen(codeServiceOnly(service), api(connections.guide(service))),
      FindServer: ({ service, webUrl }) => Effect.andThen(codeServiceOnly(service), api(connections.findServer(service, webUrl))),
      ConnectCli: ({ product, webUrl, connectionId }) =>
        Effect.andThen(
          Effect.andThen(codeHostOnly(product), codeHostConnection(connectionId)),
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
        ),
      CheckConnection: ({ connectionId }) => Effect.andThen(codeHostConnection(connectionId), api(connections.check(connectionId))),
      Disconnect: ({ connectionId }) => Effect.andThen(codeHostConnection(connectionId), api(connections.remove(connectionId, actorId))),
    } satisfies Partial<ApiHandlers>
  })
