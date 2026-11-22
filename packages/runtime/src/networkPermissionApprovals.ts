import { AlwaysScope, ApiError, PermissionApproval, plainTitle, type ClientIdentity } from '@althar/contracts'
import { canonicalJson, sha256Hex } from '@althar/persistence-sqlite'
import { Clock, Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { ApiCommands } from './ApiCommands'
import { CurrentClient } from './ClientContext'
import { ClientIdentities } from './ClientIdentities'
import { Instance } from './Instance'
import { Permissions } from './Permissions'
import { envelope } from './envelope'
import { approvalKeyEnrollment } from './approvalKeyEnrollment'
import { ApprovalCode, makePermissionApprovals, type ApprovalCredentials } from './permissionApprovals'

const unavailable = () =>
  new ApiError({ reason: 'ApprovalUnavailable', message: 'This approval is unavailable. Open the request in Althar again.' })
const Details = Schema.Struct({
  title: Schema.String,
  command: Schema.NullOr(Schema.String),
  always: Schema.optionalKey(
    Schema.Struct({
      command: Schema.NullOr(Schema.String),
      prefix: Schema.NullOr(Schema.String),
      kind: Schema.NullOr(Schema.String),
      allow: Schema.Array(AlwaysScope),
      deny: Schema.Array(AlwaysScope),
    }),
  ),
})
const Code = Schema.Struct({ code: ApprovalCode })
const Response = Schema.Struct({ ...Code.fields, proof: Schema.Unknown })
const approveMethod = 'AnswerWithProtectedApproval'

export const networkPermissionApprovals = (origin: URL, credentials: ApprovalCredentials) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const identities = yield* ClientIdentities
    const permissions = yield* Permissions
    const commands = yield* ApiCommands
    const approvals = yield* Effect.try({ try: () => makePermissionApprovals(origin, instance.homeId, credentials), catch: unavailable })
    const keys = approvalKeyEnrollment(origin, credentials)

    const begin = (identity: ClientIdentity, input: unknown) =>
      Effect.gen(function* () {
        if (identity.deviceId === instance.deviceId) return yield* unavailable()
        yield* identities.check(identity)
        const action = yield* Schema.decodeUnknownEffect(PermissionApproval)(input)
        const [ask] = yield* sql<{ payload: string }>`
          SELECT payload FROM attention_requests
          WHERE id = ${action.attentionId} AND kind = 'permission' AND state = 'open' AND addressee_actor_id = ${identity.actorId}`
        if (ask === undefined) return yield* unavailable()
        const detail = yield* Effect.try(() => Schema.decodeUnknownSync(Details)(JSON.parse(ask.payload)))
        const { always } = action
        const words = detail.always
        const remembered =
          always === undefined ? null : always === 'kind' ? words?.kind : always === 'prefix' ? words?.prefix : words?.command
        if (always !== undefined && (!words?.[action.decision === 'allow' ? 'allow' : 'deny'].includes(always) || !remembered))
          return yield* unavailable()
        const now = yield* Clock.currentTimeMillis
        const code = yield* Effect.try(() =>
          approvals.begin(identity, action, plainTitle(detail.title), detail.command, now, remembered ?? null),
        )
        return { path: `/approve-permission#${code}` }
      }).pipe(Effect.mapError(unavailable))

    const view = (input: unknown) =>
      Effect.gen(function* () {
        const { code } = yield* Schema.decodeUnknownEffect(Code)(input)
        const now = yield* Clock.currentTimeMillis
        const { identity, ...display } = yield* Effect.try(() => approvals.view(code, now))
        yield* identities.check(identity)
        return display
      }).pipe(Effect.mapError(unavailable))

    const answer = (input: unknown) =>
      Effect.gen(function* () {
        const { code, proof } = yield* Schema.decodeUnknownEffect(Response)(input)
        const now = yield* Clock.currentTimeMillis
        const { identity, action, expiresAt } = yield* Effect.tryPromise({
          try: () => approvals.verify(code, proof, now),
          catch: unavailable,
        })
        const { commandId, ...decision } = action
        return yield* commands.execute({
          identity,
          commandId,
          method: approveMethod,
          payload: decision,
          result: Schema.Void,
          handle: Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) >= expiresAt) return yield* unavailable()
            yield* identities.check(identity)
            const said = yield* envelope('attention.answer', decision, commandId).pipe(Effect.provideService(CurrentClient, identity))
            yield* permissions.answer({ ...decision, envelope: said }).pipe(Effect.mapError(unavailable))
          }),
        })
      }).pipe(Effect.mapError(unavailable))

    const result = (input: unknown) =>
      Effect.gen(function* () {
        const { code } = yield* Schema.decodeUnknownEffect(Code)(input)
        const now = yield* Clock.currentTimeMillis
        const { identity, action, state } = yield* Effect.try(() => approvals.request(code, now))
        yield* identities.check(identity)
        if (state === 'refused') return { state: 'refused' as const }
        if (state === 'open') return { state: 'pending' as const }
        const { commandId, ...payload } = action
        const digest = sha256Hex(canonicalJson({ method: approveMethod, identity, payload }))
        const [receipt] = yield* sql<{ state: string; requestDigest: string }>`
          SELECT state, request_digest FROM api_commands
          WHERE actor_id = ${identity.actorId} AND device_id = ${identity.deviceId}
            AND command_id = ${commandId} AND method = ${approveMethod}`
        if (receipt !== undefined && receipt.requestDigest !== digest) return { state: 'refused' as const }
        switch (receipt?.state) {
          case 'succeeded':
            return { state: 'accepted' as const }
          case 'failed':
          case 'uncertain':
            return { state: 'refused' as const }
          default:
            return { state: 'pending' as const }
        }
      }).pipe(Effect.mapError(unavailable))

    const enroll = (identity: ClientIdentity) =>
      Effect.gen(function* () {
        if (identity.deviceId === instance.deviceId) return yield* unavailable()
        yield* identities.check(identity)
        const device = yield* identities.lookup(identity.deviceId)
        if (device === undefined) return yield* unavailable()
        const now = yield* Clock.currentTimeMillis
        const code = yield* Effect.tryPromise(() => keys.begin(identity, device.name, now))
        return { path: `/enroll-approval-key#${code}` }
      }).pipe(Effect.mapError(unavailable))

    const enrollmentOptions = (input: unknown) =>
      Effect.gen(function* () {
        const { code } = yield* Schema.decodeUnknownEffect(Code)(input)
        const now = yield* Clock.currentTimeMillis
        const { identity, publicKey } = yield* Effect.try(() => keys.view(code, now))
        yield* identities.check(identity)
        return { publicKey }
      }).pipe(Effect.mapError(unavailable))

    const exportKey = (input: unknown) =>
      Effect.gen(function* () {
        const { code, proof } = yield* Schema.decodeUnknownEffect(Response)(input)
        const now = yield* Clock.currentTimeMillis
        const { identity, manifest } = yield* Effect.tryPromise(() => keys.finish(code, proof, now))
        yield* identities.check(identity)
        return manifest
      }).pipe(Effect.mapError(unavailable))

    return { begin, view, answer, result, enroll, enrollmentOptions, exportKey }
  })
