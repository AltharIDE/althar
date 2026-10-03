import { modelName } from '@charrette/contracts'
import type { ConfigOption } from '@charrette/provider-adapters'
import { Context, Duration, Effect, Layer, Option } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Agents } from './Config'
import { Instance } from './Instance'
import { timestamp } from './records'
import { SignIns } from './SignIns'

/*
 * Usage limits (docs/architecture/03 and 05): which agents are out, until
 * when, and what a project does about it. An agent's account is out from the
 * turn that reached its limit until the reset its error gave, or, without
 * one, for an hour, when it is tried again. What the work does meanwhile is
 * one of the project's rules (Policies): move on to the next free agent (the
 * default), or wait for the reset.
 */

/** How long an agent whose limit gave no reset time counts as out. */
const UNKNOWN_RESET = Duration.hours(1)

/** An agent whose account is out: until its reset, if it said, and when it is tried again either way. */
export interface Out {
  readonly agentId: string
  readonly resetsAt: string | null
  readonly until: string
}

/** When an agent is back, in the words a thread says it: the time, and the day where it isn't today. */
export const whenWords = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)
  if (at.toDateString() === now.toDateString()) return time
  const day = new Intl.DateTimeFormat(
    undefined,
    Duration.toMillis(Duration.days(6)) > at.getTime() - now.getTime() ? { weekday: 'long' } : { day: 'numeric', month: 'long' },
  ).format(at)
  return `${day}, ${time}`
}

/** What a thread says when an agent is out of usage: who, until when, and who takes the work over, or that it waits. */
export const outWords = (input: {
  readonly from: string
  readonly resetsAt: string | null
  /** Who takes over, on which model; `ownWork` where it is the other step's agent, so it reviews what it wrote. */
  readonly to?: { readonly agent: string; readonly model: string | null; readonly ownWork?: boolean }
  readonly waits?: 'step' | 'message'
}): string => {
  const out = `${input.from} reached its usage limit${input.resetsAt === null ? '' : `, until ${whenWords(input.resetsAt)}`}.`
  if (input.to !== undefined)
    return `${out} ${input.to.agent} takes over${input.to.model === null ? '' : `, on ${input.to.model}`}${
      input.to.ownWork === true ? ', and reviews its own work' : ''
    }.`
  if (input.waits === undefined) return out
  return `${out} ${input.waits === 'step' ? 'The step' : 'Your message'} waits until ${input.resetsAt === null ? 'it is back' : 'then'}.`
}

export class Limits extends Context.Service<
  Limits,
  {
    /** Whether the agent's account is out now, and until when. */
    out(agentId: string): Effect.Effect<Option.Option<Out>, SqlError.SqlError>
    /**
     * The first agent free to take work over, besides those given: signed in
     * on a plan, not out, in the agents' order; one the work would rather not
     * go to (the other step's) only if none else is free. An agent paid per
     * use, on a key, is never moved to unasked: that spends the person's money.
     */
    free(besides: ReadonlyArray<string>, rather?: ReadonlyArray<string>): Effect.Effect<string | undefined, SqlError.SqlError>
    /**
     * The model an agent takes work over on: the one the plan named for it on
     * the step, else the last it ran in the project, else its own default.
     */
    modelFor(input: {
      readonly agentId: string
      readonly projectId: string
      readonly planned?: { readonly agentId: string; readonly model: string | null }
    }): Effect.Effect<string | null, SqlError.SqlError>
    /** An agent's name, and a model's as a list of every agent's models names it, from the agent's latest settings. */
    named(
      agentId: string,
      model: string | null,
    ): Effect.Effect<{ readonly agent: string; readonly model: string | null }, SqlError.SqlError>
  }
>()('@charrette/runtime/Limits') {
  static readonly layer: Layer.Layer<Limits, never, SqlClient.SqlClient | Instance | Agents | SignIns> = Layer.effect(
    Limits,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const agents = yield* Agents
      const signIns = yield* SignIns

      const out = (agentId: string) =>
        Effect.gen(function* () {
          const [latest] = yield* sql<{ state: string; windows: string; observedAt: string }>`
            SELECT s.state, s.windows, s.observed_at FROM account_statuses s JOIN principals p ON p.id = s.principal_id
            WHERE p.agent_id = ${agentId} AND p.device_id = ${instance.deviceId}
            ORDER BY s.observed_at DESC LIMIT 1`
          if (latest === undefined || latest.state !== 'limited') return Option.none<Out>()
          const windows = JSON.parse(latest.windows) as ReadonlyArray<{ readonly resetsAt?: string }>
          const resetsAt = windows.find((window) => window.resetsAt !== undefined)?.resetsAt ?? null
          const until = resetsAt ?? new Date(Date.parse(latest.observedAt) + Duration.toMillis(UNKNOWN_RESET)).toISOString()
          return until > (yield* timestamp) ? Option.some({ agentId, resetsAt, until }) : Option.none<Out>()
        })

      return Limits.of({
        out,
        free: (besides, rather = []) =>
          Effect.gen(function* () {
            const candidates = agents.list.map((entry) => entry.definition.id).filter((agentId) => !besides.includes(agentId))
            // Those the work would rather not go to come last.
            for (const agentId of [...candidates.filter((id) => !rather.includes(id)), ...candidates.filter((id) => rather.includes(id))]) {
              if ((yield* signIns.of(agentId)) === 'signed_out' || (yield* signIns.paidBy(agentId)) !== 'plan') continue
              if (Option.isNone(yield* out(agentId))) return agentId
            }
            return undefined
          }),
        modelFor: (input) =>
          Effect.gen(function* () {
            if (input.planned?.agentId === input.agentId && input.planned.model !== null) return input.planned.model
            const [last] = yield* sql<{ model: string }>`
              SELECT model FROM provider_sessions WHERE project_id = ${input.projectId} AND agent_id = ${input.agentId} AND model IS NOT NULL
              ORDER BY started_at DESC LIMIT 1`
            return last?.model ?? null
          }),
        named: (agentId, model) =>
          Effect.gen(function* () {
            const agent = agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId
            if (model === null) return { agent, model: null }
            const [latest] = yield* sql<{ config: string }>`
              SELECT config FROM provider_sessions WHERE agent_id = ${agentId} ORDER BY started_at DESC LIMIT 1`
            const options =
              latest === undefined ? [] : ((JSON.parse(latest.config) as { options?: ReadonlyArray<ConfigOption> }).options ?? [])
            const offered = options.flatMap((option) => option.choices ?? []).find((choice) => choice.value === model)
            return { agent, model: offered === undefined ? model : modelName(agent, { id: model, name: offered.name }).name }
          }),
      })
    }),
  )
}
