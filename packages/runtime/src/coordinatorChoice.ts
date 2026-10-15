import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { blockedModelsOf } from './preferences'
import { SignIns } from './SignIns'

/** The same coordinator for conversation and permission judgments: its last choice here, else the last agent used. */
export const suggestedCoordinator = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const agents = yield* Agents
    const signIns = yield* SignIns
    const [thread] = yield* sql<{ id: string }>`
      SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator' AND owner_actor_id = ${instance.personId}`
    if (thread === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
    const [here] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
      SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${thread.id} ORDER BY started_at DESC, rowid DESC LIMIT 1`
    const [anywhere] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
      SELECT agent_id, model, effort FROM provider_sessions ORDER BY started_at DESC, rowid DESC LIMIT 1`
    const last = here ?? anywhere
    const entry = agents.list.find((candidate) => candidate.definition.id === last?.agentId) ?? agents.list[0]
    if (entry === undefined) return null
    const agentId = entry.definition.id
    const status = yield* signIns.of(agentId)
    const blocked = yield* blockedModelsOf(agentId)
    const again = last?.agentId === agentId && (last.model === null || !blocked.includes(last.model)) ? last : null
    return {
      threadId: thread.id,
      agentId,
      agentName: entry.definition.name,
      model: again?.model ?? null,
      effort: again?.effort ?? null,
      available: status !== 'signed_out',
    }
  })
