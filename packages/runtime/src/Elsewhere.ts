import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { BroughtIn, Elsewhere as Found, ElsewhereConversation, ElsewhereWorktree, PlanStep } from '@althar/contracts'
import { type ActorId, type CommandEnvelope, Ids, newId, type OtherTool, type ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from './Changes'
import { RuntimeConfig } from './Config'
import { branchFor, ruleOf } from './conventions'
import { type Message, transcriptOf } from './elsewhere/conversations'
import { type FoundConversation, type FoundWorktree, lookAt } from './elsewhere/look'
import { placesOf, toolNames, within } from './elsewhere/places'
import { NotFound } from './errors'
import { git } from './git'
import { Instance } from './Instance'
import { Plans } from './Plans'
import { freeSlug, Projects, slugify } from './Projects'
import { fact, timestamp } from './records'
import { indexTask } from './Search'

/*
 * Bringing in other tools' work (docs/decisions/workspaces-and-runs.md,
 * "Bringing in other tools' work"; DEV-211, DEV-37). `look` says what other
 * tools left for a project's repositories (`elsewhere/look.ts`), and what of
 * it came in already; `bringIn` brings in what the person picked:
 *
 * - **A worktree is a task in place.** Its folder stays where its tool made
 *   it, on its own branch, with what it holds: the task's workspace is that
 *   folder (`workspaces.made_by` names the tool), set up already, so Althar
 *   never runs a setup in it, and never removes it. Its plan is the person's
 *   lead and reviewer, held until they start it, so it waits Up next; a
 *   detached one is a quick task's, whose branch is made where its lead first
 *   writes. Its pull request, opened elsewhere from its branch, is its own as
 *   any is.
 * - **A conversation is a thread's history,** at its own times: the person's
 *   words and the agent's replies, after a line saying where it came from.
 *   One that ran in a worktree brought in is that task's, and comes with it;
 *   any other is an aside, on Scratch, whose copy of the default branch is
 *   made only once the person writes to it. A lead that carries one on reads
 *   it in its brief, as it reads any thread so far.
 * - **A setup is its repository's,** as a lead's `record_setup` keeps one.
 *
 * Each thing comes in on its own, in a transaction of its own, keyed in
 * `brought_in`, so bringing it in again finds it, and one that can't come in
 * says why while the rest come in. Nothing of another tool's is written.
 */

/** A message longer than this comes in cut, with a line saying so: a reply that long is mostly what a tool printed. */
const LONGEST = 8_000
/** The most messages one conversation brings in: its latest, with a line saying how many earlier ones were left out. */
const MOST = 1_200

/** How a conversation's messages come in: one reply of the agent's for each turn, however many messages it said it in, each cut short. */
export const compacted = (messages: ReadonlyArray<Message>): ReadonlyArray<Message> => {
  const joined: Array<Message> = []
  for (const message of messages) {
    const last = joined.at(-1)
    if (last !== undefined && last.role === 'agent' && message.role === 'agent')
      joined[joined.length - 1] = { ...last, text: `${last.text}\n\n${message.text}` }
    else joined.push(message)
  }
  return joined.map((message) =>
    message.text.length <= LONGEST
      ? message
      : {
          ...message,
          text: `${message.text.slice(0, LONGEST).trimEnd()}\n\n[… ${message.text.length - LONGEST} more characters left out]`,
        },
  )
}

const agentName = (agent: 'claude_code' | 'codex') => toolNames[agent]

const dateWords = (at: string | null) =>
  at === null ? null : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a worktree brought in says to its lead, as the task's description. */
export const describeWorktree = (
  worktree: Pick<FoundWorktree, 'tool' | 'path' | 'branch' | 'head' | 'name' | 'uncommitted' | 'unpushed' | 'pullRequest'>,
) => {
  const tool = toolNames[worktree.tool]
  const where = worktree.branch === null ? `detached at ${worktree.head.slice(0, 12)}` : `on its branch, ${worktree.branch}`
  const made = worktree.tool === 'hand' ? 'made by hand' : `made in ${tool}${worktree.name === '' ? '' : ` as “${worktree.name}”`}`
  const holds = [
    worktree.uncommitted > 0 ? `${plural(worktree.uncommitted, 'file')} changed and not committed` : null,
    worktree.unpushed !== null && worktree.unpushed > 0 ? `${plural(worktree.unpushed, 'commit')} not pushed` : null,
    worktree.pullRequest === null ? null : `its pull request, #${worktree.pullRequest.number} (${worktree.pullRequest.url})`,
  ].filter((one) => one !== null)
  return [
    `Work brought in from another tool: the worktree at ${worktree.path}, ${where}, ${made}. It is this task's folder, as it is: carry its work on there, and leave the folder where it is.`,
    holds.length === 0 ? null : `It has ${holds.join(', ')}.`,
    'Its conversations so far, where any came with it, are in the thread. Read where it stands before changing anything.',
  ]
    .filter((one) => one !== null)
    .join(' ')
}

/** A title from a branch: its last part, in words. */
export const titleOfBranch = (branch: string) => {
  const last = branch.split('/').at(-1) ?? branch
  const words = last.replace(/[-_]+/g, ' ').trim()
  return words === '' ? branch : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** What a worktree is called as a task: its tool's name for it, unless that is only a folder's name, else its branch in words. */
export const taskTitleOf = (worktree: Pick<FoundWorktree, 'tool' | 'name' | 'branch' | 'path'>) => {
  const named = worktree.name.trim()
  const folderOnly = named === '' || named === worktree.path.split('/').at(-1)
  if (!folderOnly || worktree.branch === null) return (named === '' ? 'Work brought in' : named).slice(0, 120)
  return titleOfBranch(worktree.branch).slice(0, 120)
}

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | RuntimeConfig

export class Elsewhere extends Context.Service<
  Elsewhere,
  {
    /** What other tools left for a project's repositories on this computer, with what came in already. */
    look(projectId: string): Effect.Effect<Found, unknown>
    /** Brings in what the person picked, by the keys `look` gave: each on its own, what came in before found, never made twice. */
    bringIn(input: {
      readonly envelope: CommandEnvelope
      readonly projectId: string
      readonly worktrees: ReadonlyArray<string>
      readonly setups: ReadonlyArray<string>
      readonly conversations: ReadonlyArray<string>
      readonly steps: ReadonlyArray<PlanStep>
    }): Effect.Effect<BroughtIn, unknown>
  }
>()('@althar/runtime/Elsewhere') {
  static readonly layer: Layer.Layer<Elsewhere, never, Store | Projects | Plans | Changes> = Layer.effect(
    Elsewhere,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const config = yield* RuntimeConfig
      const projects = yield* Projects
      const plans = yield* Plans
      const changes = yield* Changes
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const places = placesOf(config.elsewhere?.home ?? homedir(), config.elsewhere?.env ?? process.env, process.platform)
      const real = (path: string) => {
        try {
          return realpathSync(path)
        } catch {
          return path
        }
      }
      const worktreeRoot = real(config.worktreeRoot)

      /** The project's repositories here, with what each records of its setup. */
      const repositoriesOf = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ id: ProjectId; slug: string }>`
            SELECT id, slug FROM projects WHERE id = ${projectId} AND archived_at IS NULL`
          if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
          const bindings = yield* sql<{
            id: string
            slug: string
            name: string
            path: string
            base: string | null
            recorded: string | null
          }>`
            SELECT b.id, b.slug, b.display_name AS name, l.path, b.default_base_ref AS base, b.recorded_setup AS recorded
            FROM repository_bindings b JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.project_id = ${projectId} AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid`
          return { project, bindings }
        })

      const look = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { bindings } = yield* repositoriesOf(projectId)
          // Althar's own folders, whatever project they are a task's, and the sessions its agents ran.
          const ours = new Set(
            (yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE device_id = ${instance.deviceId} AND made_by IS NULL`).map(
              (row) => real(row.path),
            ),
          )
          const sessions = new Set(
            (yield* sql<{
              id: string
            }>`SELECT DISTINCT external_session_id AS id FROM provider_sessions WHERE external_session_id IS NOT NULL`).map(
              (row) => row.id,
            ),
          )
          const brought = new Map(
            (yield* sql<{ key: string; taskId: string | null }>`SELECT key, task_id FROM brought_in WHERE project_id = ${projectId}`).map(
              (row) => [row.key, row.taskId] as const,
            ),
          )
          const found = yield* lookAt(
            bindings.map((binding) => ({ bindingId: binding.id, name: binding.name, path: binding.path, defaultBranch: binding.base })),
            places,
            { ours: (path) => within(path, worktreeRoot) || ours.has(path), sessions },
          )
          const recordedOf = (bindingId: string) => {
            const raw = bindings.find((binding) => binding.id === bindingId)?.recorded ?? null
            try {
              const parsed: unknown = raw === null ? null : JSON.parse(raw)
              return typeof parsed === 'object' && parsed !== null && 'commands' in parsed && Array.isArray(parsed.commands)
                ? (parsed.commands as ReadonlyArray<unknown>)
                : null
            } catch {
              return null
            }
          }
          return {
            worktrees: found.worktrees.map((one): ElsewhereWorktree => ({
              key: one.key,
              tool: one.tool,
              repositoryId: one.bindingId,
              repository: one.repository,
              path: one.path,
              branch: one.branch,
              name: one.name,
              uncommitted: one.uncommitted,
              unpushed: one.unpushed,
              ahead: one.ahead,
              pullRequest: one.pullRequest,
              archived: one.archived,
              lastAt: one.lastAt,
              conversations: found.conversations.filter((said) => said.worktree === one.key).map((said) => said.key),
              taskId: brought.get(one.key) ?? null,
            })),
            setups: found.setups.map((one) => ({
              key: one.key,
              tool: one.tool,
              repositoryId: one.bindingId,
              repository: one.repository,
              file: one.file,
              commands: [...one.commands],
              copy: [...one.copy],
              current: JSON.stringify(recordedOf(one.bindingId)) === JSON.stringify(one.commands),
            })),
            conversations: found.conversations.map((one): ElsewhereConversation => ({
              key: one.key,
              agent: one.agent,
              title: one.title,
              startedAt: one.startedAt,
              lastAt: one.lastAt,
              prompts: one.prompts,
              worktree: one.worktree,
              taskId: brought.get(one.key) ?? null,
            })),
          } satisfies Found
        })

      /** An item in a thread, at the time it was said there: after what the thread has, in the order it is brought in. */
      const addAt = (
        place: { readonly projectId: ProjectId; readonly threadId: string },
        kind: 'user_message' | 'agent_message' | 'notice',
        content: unknown,
        at: string,
        userInputId: string | null = null,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const ledger = yield* Ledger
          const id = yield* newId(Ids.threadItem)
          yield* sql`
            INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, user_input_id, content, created_at)
            VALUES (${id}, ${place.projectId}, ${place.threadId},
              (SELECT coalesce(max(sequence), 0) + 1 FROM thread_items WHERE thread_id = ${place.threadId}),
              ${kind}, ${userInputId}, ${JSON.stringify(content)}, ${at})`
          yield* ledger.notify({ projectId: place.projectId, aggregateType: 'thread_item', aggregateId: id, aggregateRevision: 1 })
          return id
        })

      /** A conversation, whole, into a task's thread, after a line saying where it came from; recorded as brought in. */
      const bringHistory = (
        conversation: FoundConversation,
        into: { readonly projectId: ProjectId; readonly taskId: string; readonly threadId: string },
        actorId: ActorId,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const all = compacted(yield* Effect.tryPromise(() => transcriptOf(conversation)))
          const left = Math.max(0, all.length - MOST)
          const messages = all.slice(left)
          const now = yield* timestamp
          const first = conversation.startedAt ?? messages[0]?.at ?? now
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const [taken] = yield* sql<{ n: number }>`
                SELECT count(*) AS n FROM brought_in WHERE project_id = ${into.projectId} AND key = ${conversation.key}`
              if ((taken?.n ?? 0) > 0) return
              const place = { projectId: into.projectId, threadId: into.threadId }
              yield* addAt(
                place,
                'notice',
                {
                  source: 'runtime',
                  severity: 'info',
                  title: `From ${agentName(conversation.agent)}: “${conversation.title}”`,
                  description: [
                    dateWords(conversation.startedAt),
                    plural(messages.length, 'message'),
                    left === 0 ? null : `the ${left} earliest left out`,
                  ]
                    .filter((one) => one !== null)
                    .join(' · '),
                  role: 'brought_in',
                  brought: { agent: conversation.agent, id: conversation.id, cwd: conversation.cwd },
                },
                first,
              )
              let at = first
              for (const message of messages) {
                // Each at its own time, never before the one before it: the thread reads in the order it was said.
                at = message.at !== null && message.at > at ? message.at : at
                if (message.role === 'agent') {
                  yield* addAt(place, 'agent_message', { text: message.text, brought: conversation.agent }, at)
                  continue
                }
                const inputId = yield* newId(Ids.userInput)
                const [next] = yield* sql<{ sequence: number }>`
                  SELECT coalesce(max(sequence), 0) + 1 AS sequence FROM user_inputs WHERE thread_id = ${into.threadId}`
                yield* sql`INSERT INTO user_inputs ${sql.insert({
                  id: inputId,
                  projectId: into.projectId,
                  threadId: into.threadId,
                  sequence: next?.sequence ?? 1,
                  commandId: `cmd_${randomBytes(16).toString('hex')}`,
                  disposition: 'after_current',
                  body: message.text,
                  authorActorId: actorId,
                  // Said and answered elsewhere: nothing waits to be sent.
                  state: 'delivered',
                  senderKind: 'internal',
                  acceptedAt: at,
                })}`
                yield* addAt(
                  place,
                  'user_message',
                  { text: message.text, sender: { kind: 'internal' }, brought: conversation.agent },
                  at,
                  inputId,
                )
              }
              yield* sql`INSERT INTO brought_in ${sql.insert({
                projectId: into.projectId,
                key: conversation.key,
                kind: 'conversation',
                tool: conversation.agent,
                taskId: into.taskId,
                createdAt: now,
              })}`
              // What the person said there is what the task is found by, as what they say here is.
              yield* indexTask(into.taskId)
            }),
          )
        })

      /**
       * A task, its thread and its one workspace, made in one transaction: a worktree brought in, at its folder, or an aside's
       * copy, made only once the person writes to it. The caller records what it was brought in from in the same transaction.
       */
      const makeTask = (input: {
        readonly projectId: ProjectId
        readonly projectSlug: string
        readonly binding: { readonly id: string; readonly slug: string; readonly base: string | null }
        readonly title: string
        readonly description: string
        readonly request: string | null
        readonly actorId: ActorId
        readonly shelf: 'scratch' | null
        readonly workspace: {
          readonly path: (slug: string) => string
          readonly branch: (slug: string) => string
          readonly branched: boolean
          readonly baseCommit: string | null
          readonly madeBy: OtherTool | null
          /** Set up already, by the tool that made it: Althar never sets it up. */
          readonly setUp: boolean
        }
        readonly within: (taskId: string, threadId: string) => Effect.Effect<void, unknown, Store>
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          const taskId = yield* newId(Ids.task)
          const threadId = yield* newId(Ids.thread)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const taken = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE project_id = ${input.projectId}`
              const slug = freeSlug(
                slugify(input.title, 'task'),
                taken.map((row) => row.slug),
              )
              yield* sql`INSERT INTO tasks ${sql.insert({
                id: taskId,
                projectId: input.projectId,
                title: input.title,
                description: input.description,
                ...(input.request === null ? {} : { request: input.request }),
                slug,
                state: 'open',
                ...(input.shelf === null ? {} : { shelf: input.shelf }),
                createdByActorId: input.actorId,
                createdAt: at,
              })}`
              yield* sql`INSERT INTO threads ${sql.insert({ id: threadId, projectId: input.projectId, kind: 'task', taskId, createdAt: at })}`
              yield* sql`INSERT INTO task_repository_requirements ${sql.insert({
                id: yield* newId(Ids.taskRequirement),
                projectId: input.projectId,
                taskId,
                bindingId: input.binding.id,
                access: 'write',
                baseRef: input.binding.base,
              })}`
              const workspaceId = yield* newId(Ids.workspace)
              yield* sql`INSERT INTO workspaces ${sql.insert({
                id: workspaceId,
                projectId: input.projectId,
                taskId,
                bindingId: input.binding.id,
                deviceId: instance.deviceId,
                access: 'write',
                path: input.workspace.path(slug),
                baseRef: input.binding.base ?? 'main',
                ...(input.workspace.baseCommit === null ? {} : { baseCommit: input.workspace.baseCommit }),
                branch: input.workspace.branch(slug),
                state: 'ready',
                createdAt: at,
                ...(input.workspace.branched ? { branchedAt: at } : {}),
                ...(input.workspace.madeBy === null ? {} : { madeBy: input.workspace.madeBy }),
                // As Setups records a setup with nothing to run: done, so it never runs in a folder another tool set up.
                ...(input.workspace.setUp ? { setup: JSON.stringify({ at, command: null, code: null, timedOut: false, last: null }) } : {}),
              })}`
              yield* fact({
                projectId: input.projectId,
                aggregateType: 'task',
                aggregateId: taskId,
                revision: 1,
                type: 'task.created',
                payload: { title: input.title, repositories: [input.binding.slug], brought: true },
                actorId: input.actorId,
              })
              if (input.shelf !== null)
                yield* fact({
                  projectId: input.projectId,
                  aggregateType: 'task',
                  aggregateId: taskId,
                  revision: 1,
                  type: 'task.shelved',
                  payload: { shelf: input.shelf },
                  actorId: input.actorId,
                })
              yield* input.within(taskId, threadId)
              yield* indexTask(taskId)
            }),
          )
          return { taskId, threadId }
        })

      const bringIn = (input: {
        readonly envelope: CommandEnvelope
        readonly projectId: string
        readonly worktrees: ReadonlyArray<string>
        readonly setups: ReadonlyArray<string>
        readonly conversations: ReadonlyArray<string>
        readonly steps: ReadonlyArray<PlanStep>
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { project, bindings } = yield* repositoriesOf(input.projectId)
          const actorId = input.envelope.actorId
          // Read again now: what was listed may have moved on, and only what is there now comes in.
          const ours = new Set(
            (yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE device_id = ${instance.deviceId} AND made_by IS NULL`).map(
              (row) => real(row.path),
            ),
          )
          const sessions = new Set(
            (yield* sql<{
              id: string
            }>`SELECT DISTINCT external_session_id AS id FROM provider_sessions WHERE external_session_id IS NOT NULL`).map(
              (row) => row.id,
            ),
          )
          const found = yield* lookAt(
            bindings.map((binding) => ({ bindingId: binding.id, name: binding.name, path: binding.path, defaultBranch: binding.base })),
            places,
            { ours: (path) => within(path, worktreeRoot) || ours.has(path), sessions },
          )
          const broughtTask = (key: string) =>
            Effect.map(
              sql<{ taskId: string | null }>`SELECT task_id FROM brought_in WHERE project_id = ${project.id} AND key = ${key}`,
              ([row]) => row?.taskId ?? null,
            )
          const failed: Array<{ key: string; why: string }> = []
          const tasks: Array<string> = []
          const asides: Array<string> = []
          let histories = 0
          let setups = 0
          // One that fails says so and is logged; the rest come in all the same (ADR-047).
          const kept = <A>(key: string, effect: Effect.Effect<A, unknown, Store>): Effect.Effect<A | undefined, never, Store> =>
            effect.pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning('Could not bring in from another tool', cause).pipe(
                  Effect.andThen(
                    Effect.sync((): A | undefined => {
                      failed.push({ key, why: 'It couldn’t be read, so it didn’t come in.' })
                      return undefined
                    }),
                  ),
                ),
              ),
            )

          // Setups first, so a worktree brought in beside them is a task of a repository that knows how to set up the next.
          const setupFor = new Set<string>()
          for (const key of input.setups) {
            const setup = found.setups.find((one) => one.key === key)
            if (setup === undefined) {
              failed.push({ key, why: 'It isn’t in the repository any more.' })
              continue
            }
            if (setupFor.has(setup.bindingId)) {
              failed.push({ key, why: `Another tool’s setup was picked for ${setup.repository}.` })
              continue
            }
            setupFor.add(setup.bindingId)
            yield* kept(
              key,
              Effect.gen(function* () {
                yield* projects.setRepository({
                  projectId: project.id,
                  repositoryId: setup.bindingId,
                  setup: { copy: setup.copy, commands: setup.commands },
                })
                yield* sql`INSERT INTO brought_in ${sql.insert({
                  projectId: project.id,
                  key,
                  kind: 'setup',
                  tool: setup.tool,
                  bindingId: setup.bindingId,
                  createdAt: yield* timestamp,
                })} ON CONFLICT (project_id, key) DO NOTHING`
                setups++
              }),
            )
          }

          // Worktrees, each a task in place, with the conversations that ran in it as its history.
          for (const key of input.worktrees) {
            const worktree = found.worktrees.find((one) => one.key === key)
            if (worktree === undefined) {
              failed.push({ key, why: 'Its folder isn’t a worktree of the project’s any more.' })
              continue
            }
            if ((yield* broughtTask(key)) !== null) continue
            const binding = bindings.find((one) => one.id === worktree.bindingId)
            if (binding === undefined) continue
            // Its branch a task of Althar's has already: that task is its work, not a second.
            const [held] =
              worktree.branch === null
                ? []
                : yield* sql<{ title: string }>`
                    SELECT k.title FROM workspaces w JOIN tasks k ON k.id = w.task_id
                    WHERE w.binding_id = ${binding.id} AND w.branch = ${worktree.branch} AND w.branched_at IS NOT NULL
                      AND k.state IN ('draft', 'open') LIMIT 1`
            if (held !== undefined) {
              failed.push({ key, why: `Its branch is “${held.title}”’s already.` })
              continue
            }
            const made = yield* kept(
              key,
              Effect.gen(function* () {
                const base = binding.base ?? 'main'
                const baseCommit = yield* git(worktree.path, 'merge-base', 'HEAD', `origin/${base}`).pipe(
                  Effect.catch(() => git(worktree.path, 'merge-base', 'HEAD', base)),
                  Effect.orElseSucceed(() => null),
                )
                const [rules] = yield* sql<{ pattern: string | null }>`
                  SELECT json_extract(rules, '$.branchPattern') AS pattern FROM policies WHERE project_id = ${project.id}
                  ORDER BY revision DESC LIMIT 1`
                const rule = ruleOf('branch', rules?.pattern ?? undefined)
                const title = taskTitleOf(worktree)
                const created = yield* makeTask({
                  projectId: project.id,
                  projectSlug: project.slug,
                  binding: { id: binding.id, slug: binding.slug, base: binding.base },
                  title,
                  description: describeWorktree(worktree),
                  request: worktree.asked,
                  actorId,
                  shelf: null,
                  workspace: {
                    path: () => worktree.path,
                    // Detached, as Codex makes them: its branch is named now and made where its lead first writes.
                    branch: (slug) => worktree.branch ?? branchFor(rule, { key: null, slug }),
                    branched: worktree.branch !== null,
                    baseCommit: baseCommit !== null && /^[0-9a-f]{40,64}$/.test(baseCommit) ? baseCommit : null,
                    madeBy: worktree.tool,
                    setUp: true,
                  },
                  within: (taskId, threadId) =>
                    Effect.gen(function* () {
                      yield* sql`INSERT INTO brought_in ${sql.insert({
                        projectId: project.id,
                        key,
                        kind: 'worktree',
                        tool: worktree.tool,
                        taskId,
                        bindingId: binding.id,
                        createdAt: yield* timestamp,
                      })}`
                      yield* addAt(
                        { projectId: project.id, threadId },
                        'notice',
                        {
                          source: 'runtime',
                          severity: 'info',
                          title:
                            worktree.tool === 'hand'
                              ? 'Brought in: a worktree made by hand'
                              : `Brought in from ${toolNames[worktree.tool]}`,
                          description: `${worktree.path}${worktree.branch === null ? '' : ` · ${worktree.branch}`}`,
                          role: 'brought_in',
                          brought: { tool: worktree.tool, path: worktree.path },
                        },
                        yield* timestamp,
                      )
                      yield* fact({
                        projectId: project.id,
                        aggregateType: 'task',
                        aggregateId: taskId,
                        revision: 1,
                        type: 'task.brought_in',
                        payload: { tool: worktree.tool, path: worktree.path, branch: worktree.branch },
                        actorId,
                      })
                    }),
                })
                // Planned on the person's lead and reviewer, held: it waits Up next until they start it.
                if (input.steps.length > 0)
                  yield* plans.propose({
                    projectId: project.id,
                    taskId: created.taskId,
                    steps: input.steps,
                    reason: null,
                    actorId,
                    held: true,
                    end: yield* changes.endFor(project.id, created.taskId),
                    ...(worktree.branch === null ? { here: true } : {}),
                  })
                return created
              }),
            )
            if (made === undefined) continue
            tasks.push(made.taskId)
            // What ran in it comes with it, oldest first, picked or not.
            const said = found.conversations
              .filter((one) => one.worktree === key)
              .toSorted((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
            for (const conversation of said) {
              const done = yield* kept(
                conversation.key,
                Effect.as(bringHistory(conversation, { projectId: project.id, ...made }, actorId), true),
              )
              if (done === true) histories++
            }
          }

          // Conversations picked on their own: into the task their worktree became, else each an aside.
          const asked = input.conversations
            .map((key) => ({ key, conversation: found.conversations.find((one) => one.key === key) }))
            .toSorted((a, b) => (a.conversation?.startedAt ?? '').localeCompare(b.conversation?.startedAt ?? ''))
          for (const { key, conversation } of asked) {
            if (conversation === undefined) {
              failed.push({ key, why: 'It isn’t on this computer any more.' })
              continue
            }
            if ((yield* broughtTask(key)) !== null) continue
            const owner = conversation.worktree === null ? null : yield* broughtTask(conversation.worktree)
            if (owner !== null) {
              const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${owner} AND kind = 'task' LIMIT 1`
              if (thread === undefined) continue
              const done = yield* kept(
                key,
                Effect.as(bringHistory(conversation, { projectId: project.id, taskId: owner, threadId: thread.id }, actorId), true),
              )
              if (done === true) histories++
              continue
            }
            const binding = bindings.find((one) => conversation.cwd === one.path || within(conversation.cwd, real(one.path))) ?? bindings[0]
            if (binding === undefined) continue
            const made = yield* kept(
              key,
              Effect.gen(function* () {
                const base = binding.base ?? 'main'
                const baseCommit = yield* git(binding.path, 'rev-parse', '--verify', `origin/${base}^{commit}`).pipe(
                  Effect.catch(() => git(binding.path, 'rev-parse', '--verify', `${base}^{commit}`)),
                  Effect.orElseSucceed(() => null),
                )
                const created = yield* makeTask({
                  projectId: project.id,
                  projectSlug: project.slug,
                  binding: { id: binding.id, slug: binding.slug, base: binding.base },
                  title: conversation.title.slice(0, 120),
                  description: `A conversation brought in from ${agentName(conversation.agent)}, had in ${conversation.cwd}.`,
                  request: null,
                  actorId,
                  shelf: 'scratch',
                  workspace: {
                    // A copy of the default branch, as an aside has, made only once the person writes to it (bringBack.ts).
                    path: (slug) => join(config.worktreeRoot, project.slug, slug, binding.slug),
                    branch: (slug) => branchFor(null, { key: null, slug }),
                    branched: false,
                    baseCommit: baseCommit !== null && /^[0-9a-f]{40,64}$/.test(baseCommit) ? baseCommit : null,
                    madeBy: null,
                    setUp: false,
                  },
                  within: (taskId) =>
                    Effect.gen(function* () {
                      // An aside, as + makes one: its plan its first step, answered as its lead's turn ends, with nothing going outside.
                      yield* fact({
                        projectId: project.id,
                        aggregateType: 'task',
                        aggregateId: taskId,
                        revision: 1,
                        type: 'task.brought_in',
                        payload: { agent: conversation.agent, id: conversation.id },
                        actorId,
                      })
                    }),
                })
                yield* bringHistory(conversation, { projectId: project.id, ...created }, actorId)
                return created
              }),
            )
            if (made !== undefined) asides.push(made.taskId)
          }
          return { tasks, asides, setups, histories, failed } satisfies BroughtIn
        })

      return Elsewhere.of({
        look: (projectId) => run(look(projectId)),
        bringIn: (input) => run(bringIn(input)),
      })
    }),
  )
}
