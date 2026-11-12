import { type ApiResponse, ConnectorFailed, type Product, products, type ServiceApi } from '@althar/connectors'
import { Effect, Schema } from 'effect'
import type { SqlClient } from 'effect/sql'

import type { RuntimeConfig } from './Config'
import { Connections } from './Connections'
import { Errands, type FreshAction } from './Errands'
import type { Instance } from './Instance'
import { Issues } from './Issues'
import { ActionNotPerformed, type ToolAccess, ToolRefused } from './ToolServer'

export type Needs = Connections | Issues | Errands | SqlClient.SqlClient | Instance | RuntimeConfig
export const refused = (message: string) => new ToolRefused({ message })
export const Record = Schema.Record(Schema.String, Schema.Unknown)
export const Word = {
  message: Schema.optional(Schema.String),
  errand: Schema.optional(Schema.String),
  step: Schema.optional(Schema.String),
}
export const wordInput = {
  message: { type: 'string', description: 'The person’s message ID from read_turn, authorizing this write.' },
  errand: { type: 'string' },
  step: { type: 'string' },
}
export const connectionInput = {
  type: 'string',
  description: 'Connection ID from list_integrations; a unique product or workspace name also works.',
}
export const decode = <S extends Schema.Top>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(Effect.mapError(() => refused('The arguments do not match this tool’s input.')))
export const serialize = (answer: ApiResponse) => JSON.stringify(answer)

/** Resolve ambiguity explicitly: two workspaces never silently share an operation. */
export const connected = (named: string | undefined, kind?: 'host' | 'tracker' | 'linear') =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const all = (yield* connections.list).filter(
      (one) => one.state === 'ready' && (kind === 'linear' ? one.product === 'linear' : kind === undefined || products[one.product][kind]),
    )
    const key = named?.trim().toLowerCase()
    const exact = all.find((one) => one.id === named)
    const matches =
      exact === undefined
        ? all.filter(
            (one) =>
              key === undefined ||
              [one.product, one.name, one.workspace?.key, one.workspace?.name, one.webUrl].some((value) => value?.toLowerCase() === key),
          )
        : [exact]
    const one = matches[0]
    if (one === undefined || matches.length !== 1)
      return yield* refused(`Name one connected ${kind ?? 'service'} with connection; list_integrations gives the IDs and workspaces.`)
    const adapters = yield* connections.adapters(one.id)
    if (adapters.api === undefined) return yield* refused('This connection has no authenticated API transport.')
    return { ...adapters, api: adapters.api, connection: one }
  })

export const issueAt = (projectId: string, issue: string) =>
  Effect.gen(function* () {
    const read = yield* (yield* Issues).read(issue, projectId)
    const found = yield* connected(read.connectionId, 'tracker')
    return { ...found, issue: read.issue }
  })

export const ensureSuccess = (answer: ApiResponse) =>
  Effect.gen(function* () {
    const value = answer.body
    if (value !== null && typeof value === 'object')
      for (const result of Object.values(value))
        if (result !== null && typeof result === 'object' && 'success' in result && result.success === false)
          return yield* new ActionNotPerformed({ message: 'The service did not apply the requested change.' })
    return serialize(answer)
  })

/** Unknown writes stay uncertain. Without a typed read-back, a retry can never submit them twice. */
export const write = (
  name: string,
  access: ToolAccess,
  word: { readonly message?: string | undefined; readonly errand?: string | undefined; readonly step?: string | undefined },
  target: string,
  request: Readonly<Record<string, unknown>>,
  act: Effect.Effect<string, unknown, Needs>,
  read: Effect.Effect<FreshAction, unknown, Needs>,
) =>
  Effect.gen(function* () {
    const errands = yield* Errands
    const context = yield* Effect.context<Needs>()
    return yield* errands.execute(name, access, {
      ...(word.message === undefined ? {} : { messageId: word.message }),
      ...(word.errand === undefined ? {} : { errandId: word.errand }),
      ...(word.step === undefined ? {} : { step: word.step }),
      target,
      request,
      read: read.pipe(
        Effect.provideContext(context),
        Effect.mapError((error) => refused(error instanceof Error ? error.message : 'The target could not be read.')),
      ),
      readBack: Effect.succeed({
        state: 'unknown',
        reason: 'The earlier write’s answer was lost. Read the service to reconcile it; this tool will not submit it twice.',
      }),
      act: () =>
        act.pipe(
          Effect.provideContext(context),
          Effect.mapError((error) =>
            error instanceof ActionNotPerformed
              ? error
              : error instanceof ConnectorFailed && ['rejected', 'forbidden', 'unauthorized', 'not_found'].includes(error.reason)
                ? new ActionNotPerformed({ message: error.message })
                : refused(error instanceof Error ? error.message : 'The write’s answer is uncertain.'),
          ),
        ),
    })
  })

export const readyAccount = (api: ServiceApi, product: Product) =>
  api
    .request(
      product === 'linear'
        ? { query: 'query { viewer { id } }' }
        : product === 'github'
          ? { path: '/user' }
          : product === 'gitlab'
            ? { path: '/user' }
            : product === 'trello'
              ? { path: '/members/me' }
              : { path: product.startsWith('jira') ? '/myself' : '/user' },
    )
    .pipe(Effect.as({ state: 'ready' as const }))
