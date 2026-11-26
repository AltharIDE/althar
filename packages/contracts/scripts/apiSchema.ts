import { Context, Schema, SchemaAST, SchemaRepresentation } from 'effect'
import { RpcSchema } from 'effect/rpc'

import * as contracts from '../src/index'

/*
 * The wire as this contract has it, for api.schema.json: every call, command
 * and stream, whether a socket may make it, the lane it runs in, and its
 * payload, success and error as JSON Schema of what crosses (Effect's, of each
 * schema's JSON form). A schema the package exports is a definition under its
 * name, the first by name where it has several, so a change to it shows once.
 *
 * `bun run snapshot` writes it, and tests/apiSchema.test.ts fails while the
 * file differs from it: a change to the file is a change to the wire, which
 * review approves.
 */

const byName = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0)

/** Every key in order, at every depth, so the file says the same whatever order the code declares things in. */
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .toSorted(byName)
            .map(([key, inner]) => [key, sorted(inner)]),
        )
      : value

/** A stream; a command, which carries the client's id for it; or a call. */
const kindOf = (rpc: { readonly payloadSchema: Schema.Top; readonly successSchema: Schema.Top }) => {
  if (RpcSchema.isStreamSchema(rpc.successSchema)) return 'stream'
  const payload = rpc.payloadSchema.ast
  return SchemaAST.isObjects(payload) && payload.propertySignatures.some((field) => field.name === 'commandId') ? 'command' : 'call'
}

/** The wire, as the object api.schema.json holds. */
export const apiSchema = (): unknown => {
  const names = new Map<SchemaAST.AST, string>()
  for (const [name, value] of Object.entries(contracts).toSorted(byName)) {
    if (!Schema.isSchema(value)) continue
    for (const ast of [value.ast, Schema.toCodecJson(value).ast]) if (!names.has(ast)) names.set(ast, name)
  }
  const rpcs = [...contracts.Api.requests.values()].toSorted((a, b) => byName([a._tag, a], [b._tag, b]))
  const roots = rpcs.flatMap((rpc) => {
    const streamed = RpcSchema.isStreamSchema(rpc.successSchema) ? rpc.successSchema : undefined
    return [rpc.payloadSchema, streamed?.success ?? rpc.successSchema, streamed?.error ?? rpc.errorSchema].map(
      (schema) => Schema.toCodecJson(schema).ast,
    )
  })
  const [first, ...rest] = roots
  if (first === undefined) throw new Error('The API has no calls.')
  const document = SchemaRepresentation.toJsonSchemaMultiDocument(
    SchemaRepresentation.toRepresentations([first, ...rest], {
      referencePolicy: ({ ast, identifier }) => names.get(ast) ?? identifier,
    }),
  )
  return sorted({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    apiVersion: contracts.API_VERSION,
    rpcs: Object.fromEntries(
      rpcs.map((rpc, at) => [
        rpc._tag,
        {
          kind: kindOf(rpc),
          socket: Context.get(rpc.annotations, contracts.SocketAllowed),
          lane: contracts.BEHIND_CALLS.has(rpc._tag) ? contracts.BACKGROUND : 'immediate',
          payload: document.schemas[3 * at],
          success: document.schemas[3 * at + 1],
          error: document.schemas[3 * at + 2],
        },
      ]),
    ),
    $defs: document.definitions,
  })
}
