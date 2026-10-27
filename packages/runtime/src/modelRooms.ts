import { isAgentDefault, knownModelName, type ModelRoom } from '@althar/contracts'
import { Effect, Option } from 'effect'

import { Accounts } from './Accounts'
import { Agents } from './Config'
import { Installs, isInstalled } from './Installs'
import { Limits } from './Limits'
import { Models } from './Models'
import { SignIns } from './SignIns'

/*
 * How much room each model has where work on it would start, for the
 * pickers: the account Limits would pick for it (as steering does, so the
 * figure a picker shows is the one a step goes by), and that account's
 * tightest window as last read, a model's own window (Opus's week) counted.
 * A model on a key, or on a plan nothing reads, has none; the picker says
 * why from the plan usage itself.
 */
export const modelRooms = (projectId?: string) =>
  Effect.gen(function* () {
    const agents = yield* Agents
    const models = yield* Models
    const signIns = yield* SignIns
    const installs = yield* Installs
    const limits = yield* Limits
    const accounts = yield* Accounts
    const catalog = yield* models.catalog
    const rooms: ModelRoom[] = []
    for (const entry of agents.list) {
      const agentId = entry.definition.id
      if (!isInstalled(installs, entry.definition) || (yield* signIns.of(agentId)) === 'signed_out') continue
      const offered = catalog.find((one) => one.agentId === agentId)
      if (offered === undefined) continue
      const several = (yield* accounts.of(agentId)).length > 1
      for (const model of offered.models) {
        if (isAgentDefault(model) || offered.blocked.includes(model.id)) continue
        // A model's own window counts beside the plan's, by its id or its name, as Limits ranks it.
        const named = `${model.id} ${knownModelName({ id: agentId, name: entry.definition.name }, model)}`
        const starts = yield* limits.pick({ agentId, model: named, ...(projectId === undefined ? {} : { projectId }) }).pipe(Effect.option)
        if (Option.isNone(starts)) continue
        const account = yield* signIns.account(starts.value)
        if (account.status === 'signed_out' || account.paidBy !== 'plan') continue
        const room = yield* limits.room(starts.value.id, named)
        if (Option.isNone(room)) continue
        rooms.push({
          agentId,
          model: model.id,
          accountId: starts.value.id,
          accountName: starts.value.name,
          several,
          leftPercent: room.value.leftPercent,
          resetsAt: room.value.resetsAt,
          kind: room.value.kind,
          label: room.value.label,
        })
      }
    }
    return rooms
  })
