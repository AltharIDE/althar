import { modelName } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { addItem } from './threads'

/*
 * Auto's move to a lighter model (README section 7, the person's note of
 * 21 October): when a task's lead is on a heavy model and its plan is nearly
 * out, Auto moves the next step to the lightest model of the same agent that
 * would still do the work, and says so in the thread: from and to which
 * model, how much of the plan is used, and when it resets. The person can
 * keep the heavy model for that task, and Undo the keep; Auto keeps to it.
 *
 * A move is never made on a plan with room to spare, nor where the model is
 * the agent's own default (nothing is known to be lighter), nor where the
 * person kept the model. The account's own window counts too: Claude Code
 * reads Opus's week apart from the plan's.
 */

/** The share of a plan's window used at which the next step moves to a lighter model. */
export const MOVE_AT = 90

/** One of an agent's models, as the choice weighs them. */
export interface Lighter {
  readonly id: string
  readonly name: string
  /** Its score where the model list knows it; null where it doesn't. */
  readonly intelligence: number | null
  readonly blocked: boolean
}

/**
 * The model to move to: the best-scoring one of the agent's that scores below
 * the current, not switched off. Undefined where none does, or where the
 * current model has no score to compare.
 */
export const lighterOf = (current: { readonly intelligence: number | null }, models: ReadonlyArray<Lighter>): Lighter | undefined => {
  if (current.intelligence === null) return undefined
  return models
    .filter((model) => !model.blocked && model.intelligence !== null && model.intelligence < (current.intelligence ?? 0))
    .toSorted((a, b) => (b.intelligence ?? 0) - (a.intelligence ?? 0))
    .at(0)
}

/** What the thread says of the plan's window: "the week", from the window's length. */
export const windowWords = (kind: 'five_hour' | 'weekly' | 'monthly' | 'other'): string =>
  kind === 'five_hour' ? 'five hours' : kind === 'weekly' ? 'the week' : kind === 'monthly' ? 'the month' : 'the plan'

/** The plan's own name, as the line says it: Claude for Claude Code, ChatGPT for Codex. */
export const planName = (agentId: string): string =>
  ({ 'claude-code': 'Claude', codex: 'ChatGPT', 'opencode-go': 'OpenCode Go', opencode: 'OpenCode' })[agentId] ?? agentId

/** How much of the plan is used, rounded down to the percent its line says: "92%". */
export const usedPercent = (leftPercent: number) => Math.max(0, Math.min(100, Math.floor(100 - leftPercent)))

type Store = SqlClient.SqlClient | Agents | Limits | Models | ModelFacts | Ledger | Crypto.Crypto

export class AutoModels extends Context.Service<
  AutoModels,
  {
    /**
     * The model a task's step should move to, where the plan is nearly out and
     * a lighter one of the agent's would do: posted in the task's thread as
     * the line saying why, with the way back. Undefined where it stays where
     * it is, or where the person kept the model for this task.
     */
    lighter(input: {
      readonly taskId: string
      readonly projectId: ProjectId
      readonly threadId: string
      readonly agentId: string
      /** The model the step planned, as the agent's id for it; null for the agent's own. */
      readonly model: string | null
    }): Effect.Effect<{ readonly agentId: string; readonly model: string; readonly accountId?: string } | undefined, unknown>
  }
>()('@althar/runtime/AutoModels') {
  static readonly layer: Layer.Layer<AutoModels, never, Store> = Layer.effect(
    AutoModels,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const limits = yield* Limits
      const models = yield* Models
      const facts = yield* ModelFacts
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const lighter = (input: {
        readonly taskId: string
        readonly projectId: ProjectId
        readonly threadId: string
        readonly agentId: string
        readonly model: string | null
      }) =>
        Effect.gen(function* () {
          // The model the person kept for this task is the one it stays on.
          const [kept] = yield* sql<{ model: string }>`
            SELECT model FROM task_model_keeps WHERE task_id = ${input.taskId} AND agent_id = ${input.agentId}`
          if (input.model === null) return undefined
          const entry = agents.list.find((one) => one.definition.id === input.agentId)
          const offered = (yield* models.catalog).find((one) => one.agentId === input.agentId)
          if (entry === undefined || offered === undefined) return undefined
          const current = offered.models.find((one) => one.id === input.model)
          if (current === undefined) return undefined
          // A model's own window counts beside the plan's, by its id or its name (Limits.room does the naming).
          const named = `${current.id} ${modelName(entry.definition.name, current).name}`
          const previous = yield* limits
            .pick({ agentId: input.agentId, projectId: input.projectId, threadId: input.threadId, model: named })
            .pipe(Effect.option)
          const account = yield* limits
            .pick({ agentId: input.agentId, projectId: input.projectId, threadId: input.threadId, model: named, reserve: 100 - MOVE_AT })
            .pipe(Effect.option)
          if (Option.isNone(account)) return undefined
          const selected = { agentId: input.agentId, model: input.model, accountId: account.value.id }
          const switched = Option.isSome(previous) && previous.value.id !== account.value.id ? selected : undefined
          // Spend another allowed account's quota before lowering the requested model.
          // Keep also preserves the model without pinning it to a depleted account.
          if (kept !== undefined) return switched
          const room = yield* limits.room(account.value.id, named)
          if (Option.isNone(room)) return switched
          if (room.value.leftPercent > 100 - MOVE_AT) return switched
          const lighter = lighterOf(
            { intelligence: facts.of(entry.definition, current)?.intelligence ?? null },
            offered.models.map((model) => ({
              id: model.id,
              name: modelName(entry.definition.name, model).name,
              intelligence: facts.of(entry.definition, model)?.intelligence ?? null,
              blocked: offered.blocked.includes(model.id),
            })),
          )
          if (lighter === undefined) return switched
          // One line a move: a step after it on the same two models says nothing new.
          const [said] = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${input.threadId} AND kind = 'model_move'
            ORDER BY sequence DESC LIMIT 1`.pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<{ content: string }>)))
          const moved =
            said === undefined ? undefined : (JSON.parse(said.content) as { from?: { model?: string }; to?: { model?: string } })
          if (moved?.from?.model === input.model && moved.to?.model === lighter.id) return { ...selected, model: lighter.id }
          const used = usedPercent(room.value.leftPercent)
          yield* addItem({ projectId: input.projectId, threadId: input.threadId }, 'model_move', {
            taskId: input.taskId,
            from: { agentId: input.agentId, model: input.model },
            to: { agentId: input.agentId, model: lighter.id },
            why: {
              percent: used,
              plan: planName(input.agentId),
              window: windowWords(room.value.kind),
              resetsAt: room.value.resetsAt,
            },
            kept: false,
          })
          return { ...selected, model: lighter.id }
        })

      return AutoModels.of({ lighter: (input) => provide(lighter(input)) })
    }),
  )
}
