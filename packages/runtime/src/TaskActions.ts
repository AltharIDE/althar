import type { ActorId, ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from './Busy'
import { Changes } from './Changes'
import { Installs } from './Installs'
import { Accounts } from './Accounts'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { SignIns } from './SignIns'
import { stepOf } from './stepPick'
import { Agents } from './Config'
import { envelope } from './envelope'
import { Errands } from './Errands'
import { CantMerge, PushRefused } from './errors'
import { commitsOf } from './git'
import { Instance } from './Instance'
import { answeredIn, quickIn } from './kinds'
import { Plans } from './Plans'
import { PlanUsage } from './PlanUsage'
import { fact } from './records'
import { Runs, type StuckAnswer, type StuckInfo } from './Runs'
import { Sessions } from './Sessions'
import { actionsOf, standingOf, Tasks } from './Tasks'
import { addItem, updateItem } from './threads'
import { POOL, ToolRefused, ToolServer, type Tool, type ToolAccess } from './ToolServer'
import { expected, words } from './words'

/*
 * The coordinator and the leads steering a task as the person's buttons do
 * (DEV-184, ADR-086, ADR-097): stopping it or only its lead's turn, holding
 * its plan, restarting it, settling it as done, kept for later or discarded,
 * and the rest of what the window offers on a task (the Change card's push
 * and pull request, a stuck step's answers, skipping the review). Each does
 * what the person's own button does, through the same services, so what
 * applies where the task stands is decided once (`actionsOf`).
 *
 * Leads and the coordinator share these tools (ADR-097). A move acts at
 * once, in any turn, with a line in the caller's thread and in the task's
 * saying who made it, and why where the call says. What can't be
 * undone, accepting (merging here) and pushing a default branch, still acts
 * only on the person's own message in the turn (ADR-081, "The person's
 * word"); in another turn it is refused, and the person presses it
 * themselves. Discarding deletes nothing: the task's worktree and branch
 * stay, and its folder goes only as ADR-056's cleanup lets it.
 */

/**
 * What the coordinator can do to a task: the person's own buttons, by what
 * they do. Accepting a task without a pull request merges it here
 * (`merge_here`), and pushing what merged is its own step (`push_here`); a
 * stuck step's card is answered as its buttons do: accepted as it is or its
 * review skipped (`as_is`, `skip_review`), tried again on the agent it had
 * (`again`), or handed to another agent and model (`hand_on`).
 */
export const TaskMove = Schema.Literals([
  'stop',
  'stop_turn',
  'hold',
  'restart',
  'done',
  'keep',
  'discard',
  'merge_here',
  'push_here',
  'as_is',
  'skip_review',
  'again',
  'hand_on',
])
export type TaskMove = typeof TaskMove.Type

/** A repository's head as the coordinator read it: what merging it here goes up to. */
export interface HeadSeen {
  readonly repository: string
  readonly head: string
}

/**
 * A card asking the person to do one, as the coordinator's thread keeps it: open, done, declined, or no longer applying.
 * No longer made (ADR-097: moves act at once); kept so the cards threads already have still read and answer.
 */
export interface TaskAskContent {
  readonly taskId: string
  /** The task's own thread, where the card opens it. */
  readonly threadId: string
  readonly slug: string
  readonly title: string
  readonly move: TaskMove
  /** Why the coordinator asks, in a line: what it read that made it ask. */
  readonly why: string | null
  readonly state: 'open' | 'done' | 'declined' | 'moot'
  /** What became of it, once answered: what was done, or why there was nothing to do. */
  readonly said: string | null
  /** For merging here: the heads it merges up to, as the coordinator read them. */
  readonly heads?: ReadonlyArray<HeadSeen>
  /** For a stuck step: the call it answers, and the answer. */
  readonly attentionId?: string
  readonly answer?: StuckAnswer
  /** Where it goes, in a few words the card names: the branch it merges into, or the model a stuck step is handed to. */
  readonly to?: string
}

/** What a move needs beyond the task, from the coordinator's call or the card it left. */
interface MoveArgs {
  readonly heads?: ReadonlyArray<HeadSeen> | undefined
  readonly attentionId?: string | undefined
  readonly answer?: StuckAnswer | undefined
  /**
   * The person's word, checked again just before the move writes anything,
   * and once a merge or push holds its locks: a turn that ended, or an errand
   * of that word paused or called off meanwhile, stops it (Errands.stands).
   */
  readonly stands?: Effect.Effect<unknown, ToolRefused> | undefined
}

/** The tool each move done on the person's word is asked through, as errands name it. */
const TOOL_OF: Partial<Record<TaskMove, string>> = {
  done: 'accept_task',
  merge_here: 'accept_task',
  push_here: 'push_accepted_task',
  as_is: 'answer_stuck_step',
  skip_review: 'answer_stuck_step',
  again: 'answer_stuck_step',
  hand_on: 'answer_stuck_step',
}

/** Done, or nothing to do and why: the task already stands so, or the move doesn't apply where it stands. */
type Outcome = { readonly done: true; readonly said: string } | { readonly done: false; readonly said: string }

type Store =
  | SqlClient.SqlClient
  | Ledger
  | Instance
  | Crypto.Crypto
  | Tasks
  | Plans
  | Changes
  | Sessions
  | Runs
  | Errands
  | Busy
  | Agents
  | Models
  | Installs
  | ModelFacts
  | Limits
  | Accounts
  | PlanUsage
  | SignIns

/** What each move did, as a line says it of the task. */
const DID: Readonly<Record<TaskMove, (task: string) => string>> = {
  stop: (task) => `Stopped ${task}`,
  stop_turn: (task) => `Stopped the lead’s turn on ${task}`,
  hold: (task) => `Held ${task}`,
  restart: (task) => `Restarted ${task}`,
  done: (task) => `Marked ${task} done`,
  keep: (task) => `Kept ${task} for later`,
  discard: (task) => `Discarded ${task}`,
  merge_here: (task) => `Accepted ${task}, merging it here`,
  push_here: (task) => `Pushed what ${task} merged here`,
  as_is: (task) => `Accepted ${task} as it is`,
  skip_review: (task) => `Skipped the review of ${task}`,
  again: (task) => `Tried the stuck step of ${task} again`,
  hand_on: (task) => `Handed on the stuck step of ${task}`,
}

/** The same, in the task's own thread. */
const DID_HERE: Readonly<Record<TaskMove, string>> = {
  stop: 'stopped this task',
  stop_turn: 'stopped its lead’s turn',
  hold: 'held this task’s plan',
  restart: 'restarted this task',
  done: 'marked this task done',
  keep: 'kept this task for later',
  discard: 'discarded this task',
  merge_here: 'accepted this task, merging it here',
  push_here: 'pushed what this task merged here',
  as_is: 'accepted this task as it is',
  skip_review: 'skipped this task’s review',
  again: 'tried the stuck step again',
  hand_on: 'handed the stuck step on',
}

/** Why a task's branch can't be merged here, as the card's Accept says it (CantMerge). */
export const cantMerge = (slug: string, error: CantMerge) => {
  const into = error.into ?? 'its default branch'
  const files = error.files === undefined || error.files.length === 0 ? '' : ` (${error.files.join(', ')})`
  switch (error.why) {
    case 'pull_request':
      return `${slug} has a pull request for each repository: merge_pull_request merges it, and the task settles once it has.`
    case 'settled':
      return `${slug} is settled already.`
    case 'changed':
      return `${slug}’s branch isn’t at the head you read any more: read_task again, and tell the person what changed before merging what nobody saw.`
    case 'conflicts':
      return `${slug} conflicts with ${into}${files}. Its lead can resolve it: tell the person.`
    case 'resolving':
      return `${slug} conflicts with ${into}${files}, and its lead is resolving it: accept it again once it has.`
    case 'busy':
    case 'untracked':
      return `${into} is checked out in ${error.detail} with changes in the way${files}. The person commits or puts them aside first.`
    case 'submodule':
      return `A submodule the merge moves has changes in the way in ${error.detail}${files}.`
    case 'unreadable':
      return `Althar couldn’t read a checkout: ${error.detail}`
    case 'moved':
      return `${error.detail} moved while it merged: nothing was merged. Accept it again.`
    case 'missing':
      return `${slug} has no ${error.detail} here to merge into.`
    case 'nothing':
      return `${slug} has nothing to merge: its work is already in ${into}.`
  }
}

/** Why a push didn't go, as the card's Push says it (PushRefused). */
export const pushRefused = (error: PushRefused) =>
  error.why === 'behind'
    ? `${error.remote} has commits this Mac doesn’t: nothing was pushed, and nothing is forced. The person pulls first.`
    : `${error.remote} didn’t take the push (${error.why})${error.said === undefined ? '' : `: ${error.said}`}. Nothing is forced.`

/** The person's words as a line quotes them: one line, and not too long. */
export const quoted = (words: string) => {
  const line = words.replace(/\s+/g, ' ').trim()
  return `“${line.length > 140 ? `${line.slice(0, 139)}…` : line}”`
}

/**
 * The person's latest message in the live turn, from the window or a paired
 * device, as the tool server read the turn (`Errands.turn`): their word for
 * what the coordinator or a lead works out from it. Undefined where the turn
 * has none: news, a lead or Althar started it, or a socket's message.
 */
export const personsWords = (access: ToolAccess) =>
  Effect.gen(function* () {
    if (access.role === 'reviewer' || access.byPerson !== true || access.turnId == null) return undefined
    const ids = access.messages ?? []
    if (ids.length === 0) return undefined
    const sql = yield* SqlClient.SqlClient
    const [message] = yield* sql<{ body: string }>`
      SELECT body FROM user_inputs WHERE id IN ${sql.in(ids)} ORDER BY sequence DESC LIMIT 1`
    return message?.body
  })

export class TaskActions extends Context.Service<
  TaskActions,
  {
    /** The person answers a card asking them to do a move: yes does it, as their press; no leaves the task as it is. */
    answer(itemId: string, yes: boolean, actorId: ActorId): Effect.Effect<void, unknown>
  }
>()('@althar/runtime/TaskActions') {
  static readonly layer: Layer.Layer<TaskActions, never, Store | ToolServer | Agents> = Layer.effect(
    TaskActions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const tasks = yield* Tasks
      const plans = yield* Plans
      const changes = yield* Changes
      const sessions = yield* Sessions
      const runs = yield* Runs
      const errands = yield* Errands
      const busy = yield* Busy
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      /** A task of the project, by its slug or its id, with its thread and whether it is a change. */
      const taskOf = (projectId: string, reference: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{
            id: string
            slug: string
            title: string
            projectId: ProjectId
            threadId: string
            change: number
            reviews: number
            answered: number
          }>`
            SELECT k.id, k.slug, k.title, k.project_id, t.id AS thread_id,
              CASE WHEN ${sql.unsafe(quickIn('k'))} OR EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind = 'review')
                THEN 0 ELSE 1 END AS change,
              EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind = 'review') AS reviews,
              ${sql.unsafe(answeredIn('k'))} AS answered
            FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.project_id = ${projectId} AND (k.id = ${reference} OR k.slug = ${reference})`
          return task === undefined
            ? yield* new ToolRefused({ message: `This project has no task ${reference}. list_tasks shows them.` })
            : task
        })

      type Task = Effect.Success<ReturnType<typeof taskOf>>

      /**
       * The task's repositories here that have no pull request, as its card's
       * Accept merges them: each with its branch's head now and the default
       * branch it goes into.
       */
      const hereOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ slug: string; name: string; base: string; worktree: string }>`
            SELECT b.slug, b.display_name AS name, coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, w.path AS worktree
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.branched_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL)
            ORDER BY b.created_at, b.rowid`
          return yield* Effect.forEach(rows, (row) =>
            Effect.map(commitsOf(row.worktree, ['HEAD']), ([head]) => ({ ...row, head: head ?? null })),
          )
        })

      /** The task's pull requests still open, with the head each was last seen at. */
      const openChangesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const links = yield* sql<{ snapshot: string }>`
            SELECT snapshot FROM external_links WHERE task_id = ${taskId} AND kind = 'change' ORDER BY created_at`
          return links.flatMap((link) => {
            const seen = JSON.parse(link.snapshot) as { state?: string; url?: string; headSha?: string | null }
            return seen.state === 'open' && seen.url !== undefined ? [{ url: seen.url, head: seen.headSha ?? null }] : []
          })
        })

      /** The task's open stuck call, as its card shows it, where it has one. */
      const stuckOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [call] = yield* sql<{ id: string; payload: string }>`
            SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'
            ORDER BY created_at DESC LIMIT 1`
          return call === undefined ? undefined : { id: call.id, info: JSON.parse(call.payload) as StuckInfo }
        })

      /**
       * Does a move, as the person's button does: what it did, or why there was
       * nothing to do. Read where it stands first, so a move that no longer
       * applies does nothing, as a second press does.
       */
      const perform = (task: Task, move: TaskMove, actorId: ActorId, args: MoveArgs = {}) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const standing = yield* standingOf(task.id)
          const can = actionsOf(standing)
          const said = (type: string) => envelope(type, { taskId: task.id }, undefined, actorId)
          const stands = args.stands ?? Effect.void
          const nothing = (why: string): Outcome => ({ done: false, said: why })
          const did = (what = `${DID[move](task.slug)}.`): Outcome => ({ done: true, said: what })
          switch (move) {
            case 'merge_here': {
              if (standing.state !== 'open') return nothing(`${task.slug} is settled already.`)
              // As the card's Accept: up to the heads read, all of its repositories or none, nothing pushed; merged, it settles.
              const merged = yield* changes.mergeHere(task.id, args.heads ?? [], stands).pipe(
                Effect.map((done) => ({ done })),
                Effect.catchIf(
                  (error): error is CantMerge => error instanceof CantMerge,
                  (error) => Effect.succeed({ cant: cantMerge(task.slug, error) }),
                ),
              )
              if ('cant' in merged) return nothing(merged.cant)
              const into = [...new Set(merged.done.map((one) => one.branch))].join(' and ')
              const settled = (yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.id}`)[0]?.state === 'done'
              return did(
                `Merged ${task.slug} into ${into || 'its default branch'} here${settled ? ', and it is done' : ''}. Nothing was pushed: push_accepted_task pushes it, when the person says so.`,
              )
            }
            case 'push_here': {
              const pushed = yield* changes.pushHere(task.id, stands).pipe(
                Effect.map((done) => ({ done })),
                Effect.catchIf(
                  (error): error is PushRefused => error instanceof PushRefused,
                  (error) => Effect.succeed({ refused: pushRefused(error) }),
                ),
              )
              if ('refused' in pushed) return nothing(pushed.refused)
              if (pushed.done.length === 0)
                return nothing(`${task.slug} has nothing merged here to push, or its default branch follows no remote.`)
              return did(`Pushed ${pushed.done.map((one) => `${one.branch} to ${one.remote}`).join(' and ')}, for ${task.slug}.`)
            }
            case 'as_is':
            case 'skip_review':
            case 'again':
            case 'hand_on': {
              const call = yield* stuckOf(task.id)
              if (call === undefined || (args.attentionId !== undefined && call.id !== args.attentionId))
                return nothing(`${task.slug} has no stuck step waiting on the person any more.`)
              if (args.answer === undefined) return nothing(`Althar couldn’t tell what to answer ${task.slug}’s stuck step.`)
              yield* stands
              yield* runs.answerStuck({
                envelope: yield* envelope('attention.answer_stuck', { attentionId: call.id, answer: args.answer }, undefined, actorId),
                attentionId: call.id,
                answer: args.answer,
              })
              return did(
                move === 'as_is'
                  ? `Accepted ${task.slug} as it is: the task goes on without another review, and is ready.`
                  : move === 'skip_review'
                    ? `Skipped ${task.slug}’s review: the task goes on without it, and is ready.`
                    : move === 'again'
                      ? `${task.slug}’s ${call.info.step} step starts again on the agent it had.`
                      : `${task.slug}’s ${call.info.step} step goes to ${args.answer.kind === 'retry' ? [args.answer.agentId, args.answer.model].filter(Boolean).join(' on ') : 'another agent'}.`,
              )
            }
            case 'stop':
              if (!can.includes('stop')) return nothing(`${task.slug} isn’t running: there is nothing to stop.`)
              yield* tasks.stop({ envelope: yield* said('task.stop'), taskId: task.id })
              yield* changes.leadStopped({ taskId: task.id })
              return did(`Stopped ${task.slug}: its step is cut short and its agents stopped. Restarting carries it on.`)
            case 'stop_turn': {
              const lead = yield* sessions.running(task.threadId)
              if (Option.isNone(lead) || !lead.value.turnRunning)
                return nothing(`${task.slug}’s lead isn’t in a turn: there is nothing to stop.`)
              yield* changes.leadStopped({ threadId: task.threadId }, 'interrupted')
              yield* sessions.interrupt(task.threadId)
              return did(`Stopped the lead’s turn on ${task.slug}: it waits for the next message.`)
            }
            case 'hold': {
              const [plan] = yield* sql<{ id: string; startsAt: string | null }>`
                SELECT id, starts_at FROM task_plans WHERE task_id = ${task.id} AND state = 'proposed' ORDER BY proposed_at DESC LIMIT 1`
              if (plan === undefined)
                return nothing(
                  can.includes('stop')
                    ? `${task.slug} has started: there is no plan to hold. Stop it instead.`
                    : `${task.slug} has no plan waiting to start.`,
                )
              if (plan.startsAt === null) return nothing(`${task.slug} is held already: it waits until it is started.`)
              yield* plans.hold(plan.id, actorId)
              return did(`Held ${task.slug}: its plan waits until it is started.`)
            }
            case 'restart': {
              if (standing.state === 'abandoned') {
                yield* tasks.reopen({ envelope: yield* said('task.reopen'), taskId: task.id })
                // Cut short when it was discarded, it carries on as a stopped one does.
                const again = yield* standingOf(task.id)
                if (actionsOf(again).includes('resume')) yield* tasks.resume({ envelope: yield* said('task.resume'), taskId: task.id })
                return did(`Restarted ${task.slug}: it is open again, on its worktree and branch.`)
              }
              if (can.includes('start')) {
                const [plan] = yield* sql<{ id: string }>`
                  SELECT id FROM task_plans WHERE task_id = ${task.id} AND state = 'proposed' ORDER BY proposed_at DESC LIMIT 1`
                if (plan === undefined) return nothing(`${task.slug} has no plan waiting to start.`)
                const started = yield* plans.start(plan.id, actorId)
                return started === null
                  ? nothing(`${task.slug}’s plan no longer stood to start.`)
                  : did(
                      started === 'waiting'
                        ? `Started ${task.slug}: it waits for a place among the agents at work.`
                        : `Started ${task.slug}.`,
                    )
              }
              if (!can.includes('resume'))
                return nothing(
                  standing.state === 'done'
                    ? `${task.slug} is settled. Writing to its lead opens it again.`
                    : `${task.slug} isn’t stopped, held or discarded: there is nothing to restart. Message its lead to change what it does.`,
                )
              yield* tasks.resume({ envelope: yield* said('task.resume'), taskId: task.id })
              return did(`Restarted ${task.slug}: it carries on from the step it was on, with its last lead.`)
            }
            case 'done': {
              if (standing.state === 'done') return nothing(`${task.slug} is done already: it is in Settled.`)
              if (standing.state === 'abandoned') return nothing(`${task.slug} is discarded: restart it first.`)
              // A review posted and answered since is finished as a quick task is; one with a draft settles as it is posted.
              if (task.reviews === 1 && (task.answered !== 1 || standing.state !== 'open'))
                return nothing(
                  `${task.slug} reviews a pull request: it settles once its draft is posted, which the person does, or discards, on its draft. To set it aside, keep it for later instead.`,
                )
              if (task.change === 1)
                return nothing(
                  `${task.slug} is a change: it is done once its pull request merges. Merge it, or discard it to settle it without.`,
                )
              yield* stands
              return (yield* tasks.markDone({ envelope: yield* said('task.mark_done'), taskId: task.id }))
                ? did(`Marked ${task.slug} done: it is in Settled, and what it left running stops.`)
                : nothing(`${task.slug} can’t be marked done yet: it is still at work, or something on it waits on the person.`)
            }
            case 'keep': {
              if (task.change === 1)
                return nothing(`${task.slug} is a change: it waits on its pull request, not in Needs you, so there is nothing to keep.`)
              if (standing.state !== 'open') return nothing(`${task.slug} is settled already.`)
              return (yield* tasks.keep({ envelope: yield* said('task.keep'), taskId: task.id }))
                ? did(`Kept ${task.slug} for later: out of Needs you as it is, under Kept for later. Writing to it brings it back.`)
                : nothing(`${task.slug} is kept for later already.`)
            }
            case 'discard': {
              if (standing.state === 'abandoned') return nothing(`${task.slug} is discarded already.`)
              if (standing.state === 'done') {
                // Merged, with commits after its pull requests in none yet: discarding leaves those out, as its menu's Abandon does.
                const before = (yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${task.id}`)[0]?.revision
                yield* tasks.leaveOut({ envelope: yield* said('task.leave_out'), taskId: task.id })
                const after = (yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${task.id}`)[0]?.revision
                return before === after
                  ? nothing(`${task.slug} merged: it is done, and there is nothing to discard.`)
                  : did(`Left out the commits ${task.slug} made after its pull request: it stays merged, and they stay on its branch.`)
              }
              yield* tasks.abandon({ envelope: yield* said('task.abandon'), taskId: task.id })
              return did(
                `Discarded ${task.slug}: it is in Settled, its agents stopped, and its worktree and branch stay. Restarting opens it again.`,
              )
            }
          }
        })

      /** Why a move was made, where it didn't act on the person's word: after the line, as the agent said it. */
      const nonEmpty = (why: string | undefined): why is string => why !== undefined && why.trim() !== ''
      const becauseOf = (why: string | undefined) => (nonEmpty(why) ? `: ${why.trim().replace(/\.$/, '')}` : '')
      const whyOf = (input: unknown) =>
        typeof input === 'object' && input !== null && 'why' in input && typeof input.why === 'string' ? input.why : undefined

      /** A line in a thread, as Althar says what happened. */
      const line = (projectId: ProjectId, threadId: string, title: string) =>
        addItem({ projectId, threadId }, 'notice', { source: 'runtime', severity: 'info', title })

      /** What a card says, with what became of it. */
      const settle = (projectId: ProjectId, itemId: string, card: TaskAskContent, state: TaskAskContent['state'], said: string | null) =>
        updateItem(projectId, itemId, { ...card, state, said } satisfies TaskAskContent)

      const Asked = Schema.Struct({ task: Schema.String, why: Schema.optional(Schema.String) })
      const Settling = Schema.Struct({
        task: Schema.optional(Schema.String),
        how: Schema.Literals(['done', 'keep', 'discard']),
        why: Schema.optional(Schema.String),
      })
      const Stopping = Schema.Struct({ task: Schema.String, turn: Schema.optional(Schema.Boolean), why: Schema.optional(Schema.String) })
      const read = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
        Schema.decodeUnknownEffect(schema)(input).pipe(
          Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
        )

      /**
       * The person's words for a move that can't be undone, as merging takes
       * them (Errands): in a turn their own message started, the message the
       * coordinator names must be one of that turn's, from the window or a
       * paired device. Undefined in any other turn: news, a lead, Althar or a
       * socket started it, and a card asks the person instead.
       */
      const wordOf = (access: ToolAccess, message: string | undefined, task: Task, move: TaskMove) =>
        Effect.gen(function* () {
          const turn = yield* errands.turn(access)
          if (access.role === 'reviewer' || !turn.byPerson) return undefined
          if (message === undefined || !turn.messages.includes(message))
            return yield* new ToolRefused({
              message: "Name the person's message in this turn that asks it (message, from read_turn): this acts only on their own word.",
            })
          // As merge_pull_request's word: the turn live, and no errand of it paused or called off, now and again before it acts.
          const stands = errands.stands(TOOL_OF[move] ?? move, access, {
            messageId: message,
            target: task.slug,
            request: { move },
            taskId: task.id,
          })
          return { words: yield* stands, stands }
        })

      /** Who did a move, as the task's thread says it: the coordinator, or the lead of the task it came from. */
      const whoOf = (access: ToolAccess) =>
        Effect.gen(function* () {
          if (access.role !== 'lead' || access.taskId === null) return 'The coordinator'
          const sql = yield* SqlClient.SqlClient
          const [own] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${access.taskId}`
          return own === undefined ? 'Another task’s lead' : `The lead of “${own.title}”`
        })

      /** Who a move is recorded as done by: the coordinator, or Althar for a lead. */
      const actorOf = (access: ToolAccess) => (access.role === 'lead' ? instance.systemId : instance.coordinatorId)

      /** The task a call names, or, from a lead that names none, its own; the coordinator names one. */
      const named = (access: ToolAccess, reference: string | undefined) =>
        reference !== undefined && reference.trim() !== ''
          ? taskOf(access.projectId, reference)
          : access.role === 'lead' && access.taskId !== null
            ? taskOf(access.projectId, access.taskId)
            : Effect.fail(new ToolRefused({ message: 'Name the task, by its slug as list_tasks shows it.' }))

      /** What a lead may not do to its own task while it works on it: stopping or holding itself. Settling it is fine. */
      const OWN_REFUSED: ReadonlyArray<TaskMove> = ['stop', 'stop_turn', 'hold', 'restart']

      /**
       * A move asked of the coordinator or a lead: done at once, in any turn, with a line in the caller's thread and in the
       * task's (ADR-097), saying who made it and why. What can't be undone (`word`) acts only on the person's own message in
       * this turn, which the call names, and its lines quote it; in another turn nothing happens, and it says so.
       */
      const act = (
        access: ToolAccess,
        reference: string | Task,
        move: TaskMove,
        asked: {
          readonly message?: string | undefined
          readonly args?: MoveArgs
          readonly word?: true
          /** Why the coordinator or lead did it, said in both threads where it didn't act on the person's word. */
          readonly why?: string | undefined
        } = {},
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const task = typeof reference === 'string' ? yield* taskOf(access.projectId, reference) : reference
          const own = access.role === 'lead' && task.id === access.taskId
          if (own && OWN_REFUSED.includes(move))
            return yield* new ToolRefused({
              message: `${task.slug} is your own task: you can't stop, hold or restart it from inside. End your turn instead, and say why.`,
            })
          const args = asked.args ?? {}
          // What can't be undone names the person's message, as merging does: checked against the live turn, never taken on trust.
          const word = asked.word === true ? yield* wordOf(access, asked.message, task, move) : undefined
          if (asked.word === true && word === undefined)
            return yield* new ToolRefused({
              message: `This can't be undone, so it acts only on the person's own message in this turn, from the window or a paired device: nothing changed. Tell the person; they can do it from ${task.slug}'s card themselves, or ask you in a message.`,
            })
          // Only what acts on the person's word quotes them; any other move says who did it, and why (ADR-086).
          const words = word?.words
          // A lead discarding its own task: as its turn ends, as its agents stop then, so its word on it reaches the person.
          if (own && move === 'discard') {
            const standing = yield* standingOf(task.id)
            if (standing.state === 'abandoned') return 'It is discarded already.'
            if (standing.state === 'done') return 'It is done already: it is in Settled, so there is nothing to discard.'
            const actorId = actorOf(access)
            yield* Effect.forkDetach(
              Effect.gen(function* () {
                yield* sessions.untilIdle(task.threadId, Duration.minutes(2))
                yield* perform(task, move, actorId)
              }).pipe(
                provide,
                Effect.catchCause((cause) => Effect.logWarning('Could not discard a task its lead was told to', cause)),
              ),
            )
            return 'It is discarded as your turn ends: it moves to Settled, its agents stop, and its work stays on this computer. End your turn with a sentence saying so.'
          }
          const outcome = yield* perform(task, move, actorOf(access), { ...args, stands: word?.stands })
          if (!outcome.done) return `Nothing changed: ${outcome.said}`
          const as = words === undefined ? becauseOf(asked.why) : `, as you asked: ${quoted(words)}`
          if (access.threadId !== task.threadId) yield* line(task.projectId, access.threadId, `${DID[move](`“${task.title}”`)}${as}`)
          yield* line(task.projectId, task.threadId, `${own ? 'Its lead' : yield* whoOf(access)} ${DID_HERE[move]}${as}`)
          yield* fact({
            projectId: task.projectId,
            aggregateType: 'task',
            aggregateId: task.id,
            revision: (yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${task.id}`)[0]?.revision ?? 1,
            type: words === undefined ? 'task.moved' : 'task.moved_on_word',
            payload: {
              move,
              ...(words === undefined ? {} : { words }),
              ...(nonEmpty(asked.why) ? { why: asked.why } : {}),
              by: access.role,
            },
            actorId: actorOf(access),
          })
          return `${outcome.said} ${access.threadId === task.threadId ? 'Its thread has a line saying so' : 'Both threads have a line saying so'}; say it in a sentence.`
        })

      const answer = (itemId: string, yes: boolean, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [item] = yield* sql<{ projectId: ProjectId; threadId: string; content: string }>`
            SELECT project_id, thread_id, content FROM thread_items WHERE id = ${itemId} AND kind = 'task_ask'`
          if (item === undefined) return
          const card = JSON.parse(item.content) as TaskAskContent
          // Answered already, a second press is the first.
          if (card.state !== 'open') return
          const task = yield* taskOf(item.projectId, card.taskId).pipe(Effect.option)
          if (!yes || Option.isNone(task)) {
            yield* settle(item.projectId, itemId, card, 'declined', null)
            yield* heard(item.projectId, card, 'declined', null, actorId)
            return
          }
          const outcome = yield* perform(task.value, card.move, actorId, {
            heads: card.heads,
            attentionId: card.attentionId,
            answer: card.answer,
          })
          yield* settle(item.projectId, itemId, card, outcome.done ? 'done' : 'moot', outcome.said)
          if (outcome.done)
            yield* line(task.value.projectId, task.value.threadId, `You ${DID_HERE[card.move]}, from the coordinator’s card.`)
          yield* heard(item.projectId, card, outcome.done ? 'done' : 'moot', outcome.said, actorId)
        })

      /** What the person answered, kept for the coordinator to hear at its next turn. */
      const heard = (projectId: ProjectId, card: TaskAskContent, state: TaskAskContent['state'], said: string | null, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${card.taskId}`
          yield* fact({
            projectId,
            aggregateType: 'task',
            aggregateId: card.taskId,
            revision: task?.revision ?? 1,
            type: 'task.ask_answered',
            payload: { move: card.move, state, said },
            actorId,
          })
        })

      const tool = (
        name: string,
        description: string,
        input: Readonly<Record<string, unknown>>,
        call: (access: ToolAccess, input: unknown) => Effect.Effect<string, unknown, Store>,
      ): Tool => ({
        name,
        description,
        input,
        call: (value, access) =>
          provide(call(access, value)).pipe(
            Effect.catch((error) =>
              error instanceof ToolRefused
                ? Effect.fail(error)
                : Effect.andThen(
                    Effect.logWarning('A task action did not succeed', error),
                    Effect.fail(
                      new ToolRefused({
                        message: (() => {
                          // What failed, in the window's words; a failure with none of its own is named by its kind.
                          const said = words(error, (agentId) => agentId)
                          return said.reason === 'Unknown' || said.message.startsWith("Althar's runtime couldn't do that")
                            ? `Althar could not do that${said.reason === 'Unknown' ? '' : ` (${said.reason})`}, and what it did is in its log. Try again, or tell the person.`
                            : `Nothing was done: ${said.message}`
                        })(),
                      }),
                    ),
                  ),
            ),
          ),
      })
      const task = { type: 'string', description: "The task's slug, as list_tasks shows it." }
      const message = { type: 'string', description: "The person's message in this turn that asks it, by its id from read_turn." }
      const why = {
        type: 'string',
        description: 'Why, in a few plain words, said after the line in both threads: "the person asked", or what is going wrong.',
      }

      const Accepting = Schema.Struct({
        task: Schema.String,
        head: Schema.optional(Schema.String),
        heads: Schema.optional(Schema.Array(Schema.Struct({ repository: Schema.String, head: Schema.String }))),
        message: Schema.optional(Schema.String),
        why: Schema.optional(Schema.String),
      })
      const Pushing = Schema.Struct({ task: Schema.String, message: Schema.optional(Schema.String), why: Schema.optional(Schema.String) })
      const Answering = Schema.Struct({
        task: Schema.String,
        answer: Schema.Literals(['as_is', 'skip_review', 'again', 'hand_on']),
        agent: Schema.optional(Schema.String),
        model: Schema.optional(Schema.String),
        effort: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
        why: Schema.optional(Schema.String),
      })
      const commit = /^[0-9a-f]{7,64}$/

      /**
       * Accepting a task, as its card's Accept does: one that isn't a change is
       * marked done; one with no pull request merges here, up to the heads the
       * coordinator read, and settles. One whose work is all in pull requests
       * is merged with merge_pull_request, which settles it once it merges.
       */
      const accept = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Accepting, input)
          const task = yield* taskOf(access.projectId, asked.task)
          if (task.change === 0) return yield* act(access, task, 'done', { message: asked.message, word: true })
          const open = yield* openChangesOf(task.id)
          const here = yield* hereOf(task.id)
          const viaPullRequest = open
            .map(
              (change) =>
                `${change.url}${change.head === null ? '' : ` (at ${change.head})`} merges with merge_pull_request, its link and that head, on the person’s message; the task settles as done once it has merged, with no settle_task after.`,
            )
            .join(' ')
          if (here.length === 0)
            return open.length > 0
              ? `Nothing changed: ${task.slug}’s work is in its pull request. ${viaPullRequest}`
              : `Nothing changed: ${task.slug} has no branch here with work to merge.`
          const unread = here.filter((repository) => repository.head === null)
          if (unread.length > 0)
            return yield* new ToolRefused({
              message: `Althar couldn’t read ${unread.map((one) => one.name).join(' and ')}’s branch for ${task.slug}: nothing can be merged.`,
            })
          const heads: ReadonlyArray<HeadSeen> =
            asked.heads ??
            (asked.head !== undefined && here.length === 1 && here[0] !== undefined ? [{ repository: here[0].slug, head: asked.head }] : [])
          const now = here.map((repository) => `${repository.slug} at ${repository.head}`).join(', ')
          if (heads.length === 0 || here.some((repository) => !heads.some((seen) => seen.repository === repository.slug)))
            return yield* new ToolRefused({
              message: `Name the head you read for each repository (head, or heads for several), so what is merged is what the person saw: ${task.slug} is at ${now} now. read_task shows it.`,
            })
          if (heads.some((seen) => !commit.test(seen.head)))
            return yield* new ToolRefused({ message: `A head is a commit’s hash: ${task.slug} is at ${now} now.` })
          const into = [...new Set(here.map((repository) => repository.base))].join(' and ')
          const answer = yield* act(access, task, 'merge_here', { message: asked.message, word: true, args: { heads } })
          return open.length > 0 ? `${answer} Its pull request is apart: ${viaPullRequest}` : `${answer} It merges into ${into}.`
        })

      /** The ways a stuck step's card offers to try again on the agent it had: none where the lead's own work went wrong, which it is told about instead. */
      const tellFirst: ReadonlyArray<StuckInfo['why']> = ['no_report', 'round_limit', 'stalled', 'looping', 'refused']

      /** Answering a task's stuck step, as its card's buttons do. */
      const answerStuck = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Answering, input)
          const task = yield* taskOf(access.projectId, asked.task)
          const call = yield* stuckOf(task.id)
          if (call === undefined) return `Nothing changed: ${task.slug} has no stuck step waiting on the person.`
          const { info } = call
          const cant = (why: string) => new ToolRefused({ message: `${task.slug}’s stuck step is its ${info.step}: ${why}` })
          // As the card's buttons, at once: none of them can't be undone (ADR-097).
          const on = (move: TaskMove, answer: StuckAnswer) =>
            act(access, task, move, { args: { attentionId: call.id, answer }, why: asked.why })
          // A lead waiting on the person is answered by them, with the answer they give it; none of the card's other ways apply.
          if (info.why === 'waiting_on_person')
            return yield* cant('it waits for the person’s answer: they answer it in the task, and their answer starts it again.')
          switch (asked.answer) {
            case 'as_is':
            case 'skip_review':
              if (info.step !== 'review')
                return yield* cant(
                  'only a review’s card accepts it as it is or skips it. stop_task or settle_task settle the task instead.',
                )
              // The card's one button: Accept it as it is where the review ran out of rounds, else Skip the review.
              return yield* on(info.why === 'round_limit' ? 'as_is' : 'skip_review', { kind: 'abandon' })
            case 'again':
              if (info.step === 'publish') return yield* on('again', { kind: 'retry', agentId: 'althar' })
              if (info.agentId === null) return yield* cant('it had no agent to try again: hand it on to one (hand_on).')
              if (info.step !== 'review' && tellFirst.includes(info.why))
                return yield* cant(
                  'its card doesn’t offer trying the lead again, since its work went wrong: the person tells the lead what to do, or it is handed on.',
                )
              return yield* on('again', { kind: 'retry', agentId: info.agentId })
            case 'hand_on': {
              if (info.step === 'publish') return yield* cant('Althar opens the pull request itself: try it again instead.')
              if (asked.agent === undefined) return yield* cant('name the agent to hand it to (agent), and its model where it has several.')
              // The agent by its name or its id, and its model as list_models writes it or by the agent's id: refused here, not on a card.
              const handed = yield* stepOf(
                access.projectId,
                {
                  agent: asked.agent,
                  ...(asked.model === undefined ? {} : { model: asked.model }),
                  ...(asked.effort === undefined ? {} : { effort: asked.effort }),
                },
                undefined,
                true,
              )
              return yield* on('hand_on', {
                kind: 'retry',
                agentId: handed.agentId,
                ...(handed.model === null ? {} : { model: handed.model }),
                ...('effort' in handed ? { effort: handed.effort } : {}),
              })
            }
          }
        })

      /* ---- The rest of the window's buttons on a task, each as its button does (ADR-097, "Matching the window") ---- */

      const Pushed = Schema.Struct({
        task: Schema.optional(Schema.String),
        head: Schema.String,
        pull_request: Schema.optional(Schema.String),
      })
      const Named = Schema.Struct({ task: Schema.optional(Schema.String) })
      const Branches = Schema.Struct({
        task: Schema.optional(Schema.String),
        heads: Schema.optional(Schema.Array(Schema.Struct({ repository: Schema.String, head: Schema.String }))),
      })
      const Conflicts = Schema.Struct({
        task: Schema.optional(Schema.String),
        now: Schema.optional(Schema.Boolean),
        automatically: Schema.optional(Schema.NullOr(Schema.Boolean)),
      })
      const Following = Schema.Struct({ task: Schema.optional(Schema.String), pull_request: Schema.String })

      /** A button's work on a task, said in both threads as a move is: what it did, from the call's own words. */
      const did = (access: ToolAccess, input: unknown, task: Task, what: string, here: string) =>
        Effect.gen(function* () {
          const own = access.role === 'lead' && task.id === access.taskId
          const as = becauseOf(whyOf(input))
          if (access.threadId !== task.threadId) yield* line(task.projectId, access.threadId, `${what}${as}`)
          yield* line(task.projectId, task.threadId, `${own ? 'Its lead' : yield* whoOf(access)} ${here}${as}`)
        })

      /**
       * A failure Changes or Runs said, in the words the window says it in (words.ts), passed on: a tagged error's own
       * message is empty. Anything else is Althar's.
       */
      const plainly = <A, R>(effect: Effect.Effect<A, unknown, R>, slug: string) =>
        effect.pipe(
          Effect.catch((error) => {
            if (error instanceof ToolRefused) return Effect.fail(error)
            if (error instanceof PushRefused) return Effect.fail(new ToolRefused({ message: pushRefused(error) }))
            if (error instanceof CantMerge) return Effect.fail(new ToolRefused({ message: cantMerge(slug, error) }))
            const said = words(error, (agentId) => agentId)
            return Effect.fail(
              expected.has(said.reason) ? new ToolRefused({ message: `Nothing changed for ${slug}: ${said.message}` }) : error,
            )
          }),
        )

      const pushTask = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Pushed, input)
          const task = yield* named(access, asked.task)
          if (!commit.test(asked.head))
            return yield* new ToolRefused({ message: `head is a commit's hash, as read_task shows ${task.slug}'s branch at.` })
          const { change } = yield* plainly(changes.push(task.id, asked.head, asked.pull_request), task.slug)
          yield* did(access, input, task, `Pushed “${task.title}” to its pull request`, 'pushed its commits to its pull request')
          return `Pushed ${task.slug}'s branch up to ${asked.head.slice(0, 7)} to ${change.url ?? 'its pull request'}: a plain push, nothing forced. Both threads have a line saying so.`
        })

      const skipReview = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Named, input)
          const task = yield* named(access, asked.task)
          const said = yield* envelope('task.skip_review', { taskId: task.id }, undefined, actorOf(access))
          yield* plainly(runs.skipReview({ envelope: said, taskId: task.id }), task.slug)
          yield* did(access, input, task, `Skipped the review of “${task.title}”`, 'skipped this task’s review')
          return `Skipped ${task.slug}'s review: it is ready once its lead is done, with no review. Both threads have a line saying so.`
        })

      const shipTask = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Named, input)
          const task = yield* named(access, asked.task)
          // Its own lead asks in its turn: it ships once that turn ends, with all the turn committed.
          const own = access.role === 'lead' && task.id === access.taskId
          const said = yield* envelope('task.ship', { taskId: task.id }, undefined, actorOf(access))
          yield* plainly(runs.ship({ envelope: said, taskId: task.id, ...(own ? { afterTurn: true } : {}) }), task.slug)
          yield* did(access, input, task, `Shipped “${task.title}”`, 'shipped this task')
          return `${own ? 'Althar ships this task once your turn ends' : `Shipping ${task.slug}`}: where its plan has a reviewer before the work ships, the review runs first, over everything since the last one, and the lead settles what it finds; then its commits go up, to the open pull request, or a new one after the last merged or closed. read_task shows where it stands. Both threads have a line saying so.`
        })

      const publishTask = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Named, input)
          const task = yield* named(access, asked.task)
          yield* plainly(runs.publish(task.id), task.slug)
          yield* did(access, input, task, `Opened a pull request for “${task.title}”`, 'opened a pull request for this task')
          return `Althar opens ${task.slug}'s pull request now, as its card's button does: read_task shows it once it is up. Both threads have a line saying so.`
        })

      const pushBranch = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Branches, input)
          const task = yield* named(access, asked.task)
          const here = yield* hereOf(task.id)
          const heads =
            asked.heads ??
            here.flatMap((repository) => (repository.head === null ? [] : [{ repository: repository.slug, head: repository.head }]))
          const pushed = yield* plainly(changes.pushBranch(task.id, heads), task.slug)
          if (pushed.length === 0) return `Nothing changed: ${task.slug} has no branch here with a remote to push to.`
          yield* did(access, input, task, `Pushed the branch of “${task.title}”`, 'pushed this task’s branch')
          return `Pushed ${pushed.map((one) => `${one.branch} to ${one.remote}`).join(' and ')}, for ${task.slug}: a plain push, nothing forced.`
        })

      const resolveConflicts = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Conflicts, input)
          const task = yield* named(access, asked.task)
          const said: Array<string> = []
          if (asked.automatically !== undefined) {
            const made = yield* envelope(
              'task.set_conflicts',
              { taskId: task.id, resolveConflicts: asked.automatically },
              undefined,
              actorOf(access),
            )
            yield* plainly(
              changes.setResolveConflicts({ envelope: made, taskId: task.id, resolveConflicts: asked.automatically }),
              task.slug,
            )
            const how = asked.automatically === null ? 'as its project says' : asked.automatically ? 'automatically' : 'only when asked'
            yield* did(access, input, task, `“${task.title}” resolves conflicts ${how} now`, `set this task to resolve conflicts ${how}`)
            said.push(`${task.slug} resolves conflicts ${how} now.`)
          }
          if (asked.now === true || asked.automatically === undefined) {
            yield* changes.resolveNow({ taskId: task.id }, true)
            yield* did(
              access,
              input,
              task,
              `Asked “${task.title}” to resolve its conflicts`,
              'asked this task’s lead to resolve its conflicts',
            )
            said.push(`${task.slug}'s lead is asked to resolve its conflict with the branch it goes into, where it has one.`)
          }
          return `${said.join(' ')} Both threads have a line saying so.`
        })

      const moveToFront = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Named, input)
          const task = yield* named(access, asked.task)
          if (!(yield* busy.move(task.id, 0))) return `Nothing changed: ${task.slug} isn't waiting for a place among the agents at work.`
          yield* did(access, input, task, `Moved “${task.title}” to the front of the line`, 'moved this task to the front of the line')
          return `${task.slug} is first in line now: it starts when the next agent's place frees.`
        })

      const stopFollowing = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(Following, input)
          const task = yield* named(access, asked.task)
          yield* plainly(changes.stopListening(task.id, asked.pull_request), task.slug)
          yield* did(
            access,
            input,
            task,
            `“${task.title}” no longer follows ${asked.pull_request}`,
            `stopped following ${asked.pull_request}`,
          )
          return `${task.slug} no longer follows ${asked.pull_request}: its reviews, comments and checks aren't heard any more. attach_pull_request follows it again.`
        })

      const optionalTask = {
        type: 'string',
        description: "The task's slug, as list_tasks shows it. A task's lead may leave it out for its own task.",
      }

      yield* (yield* ToolServer).serve(POOL, [
        tool(
          'stop_task',
          'Stops a task, as its Stop does: its step is cut short and its agents stop, its work kept. With turn, only its lead’s current turn ends, and it waits for the next message. restart_task carries a stopped task on. It acts at once, with a line in your thread and the task’s; do it when the person asks, or when a task is plainly going wrong and say why. A lead can’t stop its own task: it ends its turn.',
          { type: 'object', properties: { task, turn: { type: 'boolean' }, why }, required: ['task'] },
          (access, input) =>
            Effect.flatMap(read(Stopping, input), (asked) =>
              act(access, asked.task, asked.turn === true ? 'stop_turn' : 'stop', { why: asked.why }),
            ),
        ),
        tool(
          'hold_task',
          'Holds a task’s plan that is counting down to start: it waits until it is started (restart_task). For a task already at work, stop it instead. It acts at once, with a line in your thread and the task’s.',
          { type: 'object', properties: { task, why }, required: ['task'] },
          (access, input) => Effect.flatMap(read(Asked, input), (asked) => act(access, asked.task, 'hold', { why: asked.why })),
        ),
        tool(
          'restart_task',
          'Restarts a task, as its Start now, Resume and Reopen do: a held one starts, a stopped one carries on from its step with its last lead, and a discarded one opens again on its worktree and branch. It acts at once, with a line in your thread and the task’s.',
          { type: 'object', properties: { task, why }, required: ['task'] },
          (access, input) => Effect.flatMap(read(Asked, input), (asked) => act(access, asked.task, 'restart', { why: asked.why })),
        ),
        {
          ...tool(
            'settle_task',
            'Settles a task when the person says it is done, to keep it for later, or to discard it, as its menu does. done and keep are for a task that isn’t a change (a quick task, or a review once its review was posted); a change is done when its pull request merges. discard settles any task as it stands (its menu’s Abandon): its worktree and branch stay, and restart_task opens it again; a lead discarding its own task does so as its turn ends. It acts at once, with a line in your thread and the task’s. A task’s lead may leave task out for its own. One call for each task.',
            {
              type: 'object',
              properties: { task: optionalTask, how: { type: 'string', enum: ['done', 'keep', 'discard'] }, why },
              required: ['how'],
            },
            (access, input) =>
              Effect.gen(function* () {
                const asked = yield* read(Settling, input)
                const target = yield* named(access, asked.task)
                // A review's lead, which reads only, settles its own review and nothing else.
                if (access.role === 'lead' && target.id !== access.taskId) {
                  const own = yield* taskOf(access.projectId, access.taskId ?? '')
                  if (own.reviews === 1) return yield* new ToolRefused({ message: 'A review’s lead settles only its own review.' })
                }
                return yield* act(access, target, asked.how, { why: asked.why })
              }),
          ),
          // A review's lead keeps or discards its review as the person says, as any task's that isn't a change.
          inReview: true,
        },
        tool(
          'skip_review',
          'Skips the review of a task’s work under way, as its menu’s Skip the review does: it is ready once its lead is done, with no review. For a task the person wants without its review; a stuck review is answered with answer_stuck_step. It acts at once, with a line in your thread and the task’s.',
          { type: 'object', properties: { task: optionalTask, why } },
          skipReview,
        ),
        tool(
          'push_task',
          'Pushes a task’s commits to its pull request, up to the commit you read (head, as read_task shows its branch), as the Push button on its Change card does: a plain push, never forced, and nothing newer than that head. pull_request picks one, by its link, in a task of several. Where its pull request has commits the branch doesn’t, nothing is pushed and it says so: its lead merges them in. It acts at once, with a line in your thread and the task’s.',
          {
            type: 'object',
            properties: {
              task: optionalTask,
              why,
              head: { type: 'string', description: 'The commit its branch is at, as you read it.' },
              pull_request: { type: 'string', description: 'Its pull request’s link, in a task of several.' },
            },
            required: ['head'],
          },
          pushTask,
        ),
        tool(
          'ship_task',
          'Ships what waits on a task’s branch, as its Ship button does, on the person’s word ("ship it", "push it"): what the person’s turns with its lead committed after its plan stays on the branch until then. Where its plan has a reviewer before the work ships, one review runs first, over everything since the last review, and its lead settles what it finds; then the commits go up, to its open pull request, or a new one after the last merged or closed. A lead shipping its own task ships it once its turn ends. It acts at once, with a line in your thread and the task’s.',
          { type: 'object', properties: { task: optionalTask, why } },
          shipTask,
        ),
        tool(
          'open_task_pull_request',
          'Opens the pull request of a task whose work ended on its branch, or a new one for its commits after its last pull request merged, as its Change card’s button does: Althar opens it as it opens every task’s, by the project’s naming, as a draft unless its plan said ready. Not for a branch of the repository’s own: open_pull_request does that, on the person’s word. It acts at once, with a line in your thread and the task’s.',
          { type: 'object', properties: { task: optionalTask, why } },
          publishTask,
        ),
        tool(
          'push_task_branch',
          'Pushes a task’s branch to its repositories’ remotes, as its Change card’s Push branch does where its host isn’t connected to Althar: up to the heads you read (heads, each repository’s, as read_task shows), or where it is now without them. A plain push, never forced. It acts at once, with a line in your thread and the task’s.',
          {
            type: 'object',
            properties: {
              task: optionalTask,
              why,
              heads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { repository: { type: 'string' }, head: { type: 'string' } },
                  required: ['repository', 'head'],
                },
              },
            },
          },
          pushBranch,
        ),
        tool(
          'resolve_conflicts',
          'A task’s conflicts with the branch it goes into, as its menu does: now asks its lead to resolve one now, whatever kept it from being asked (Resolve now); automatically sets whether its lead resolves conflicts on its own (true, false, or null to go by the project). It acts at once, with a line in your thread and the task’s.',
          {
            type: 'object',
            properties: {
              task: optionalTask,
              why,
              now: { type: 'boolean' },
              automatically: { type: ['boolean', 'null'] },
            },
          },
          resolveConflicts,
        ),
        tool(
          'move_to_front',
          'Moves a task that waits for a place among the agents at work to the front of the line, as its card’s Move to front does: it starts when the next place frees.',
          { type: 'object', properties: { task: optionalTask, why } },
          moveToFront,
        ),
        tool(
          'stop_following',
          'Stops a task following one of its pull requests, by its link, as its card does: its reviews, comments and checks aren’t heard any more. attach_pull_request follows it again.',
          { type: 'object', properties: { task: optionalTask, pull_request: { type: 'string' }, why }, required: ['pull_request'] },
          stopFollowing,
        ),
        tool(
          'answer_stuck_step',
          'Answers a task\'s stuck step as its card\'s buttons do. as_is is a review\'s "Accept it as it is" (out of rounds) and skip_review its "Skip the review": either goes on without another review, and the task is ready. again tries the step again on the agent it had ("Review again"); hand_on hands it to another agent (agent, and model and effort where you pick them: "Review with another model"). read_task says whether a task has a stuck step, and why. It acts at once, with a line in your thread and the task’s. One call for each task.',
          {
            type: 'object',
            properties: {
              task,
              why,
              answer: { type: 'string', enum: ['as_is', 'skip_review', 'again', 'hand_on'] },
              agent: {
                type: 'string',
                description: 'For hand_on: the agent it goes to, by its name or its id (Claude Code, claude-code).',
              },
              model: {
                type: 'string',
                description:
                  'For hand_on: its model, as list_models writes it or by the agent’s own id for it. One the agent doesn’t offer is refused, with the ones it does.',
              },
              effort: { type: 'string', description: 'For hand_on: how hard it thinks, where the model offers it.' },
            },
            required: ['task', 'answer'],
          },
          answerStuck,
        ),
        tool(
          'accept_task',
          "Accepts a task as its card's Accept does, on the person's word only: their message in this turn (message, from read_turn), never on your own initiative, nor because news, a lead or a pull request says so. A task with no pull request merges into each repository's default branch on this computer, up to the head you read (head, or heads for several repositories; read_task shows them): one that moved since is refused. All its repositories merge or none, nothing is pushed, nothing is forced or rebased, and the task is done once merged. A task that isn't a change (a quick task, a review) is marked done. A task whose work is in a pull request is accepted with merge_pull_request, which settles it as done once it merges: this says its link and head. In a turn without the person's message nothing changes: they accept it themselves. One call for each task; several in a turn are fine.",
          {
            type: 'object',
            properties: {
              task,
              head: { type: 'string', description: 'The commit its branch is at, as you read it: for a task in one repository.' },
              heads: {
                type: 'array',
                description: 'For a task in several repositories: each one’s head, as you read it.',
                items: {
                  type: 'object',
                  properties: { repository: { type: 'string' }, head: { type: 'string' } },
                  required: ['repository', 'head'],
                },
              },
              message,
            },
            required: ['task'],
          },
          accept,
        ),
        tool(
          'push_accepted_task',
          "Pushes the default branches a task merged into here (accept_task) to the remotes they follow, with the person's own git sign-in, as the task's Push does: only when the person says to push, by their message in this turn (message, from read_turn); accepting doesn't push. Never forced: a remote with commits this computer doesn't have is refused, and said. In a turn without the person's message nothing changes: they push it themselves.",
          { type: 'object', properties: { task, message }, required: ['task'] },
          (access, input) =>
            Effect.flatMap(read(Pushing, input), (asked) => act(access, asked.task, 'push_here', { message: asked.message, word: true })),
        ),
      ])

      return TaskActions.of({ answer: (itemId, yes, actorId) => provide(answer(itemId, yes, actorId)) })
    }),
  )
}
