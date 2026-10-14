import { createHash } from 'node:crypto'

import { type CommandEnvelope, type ProjectId } from '@althar/domain'
import type { Commands, Ledger } from '@althar/persistence-sqlite'
import { ConnectorFailed } from '@althar/connectors'
import { knownModelName } from '@althar/contracts'
import { Context, type Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from './Busy'
import { Changes } from './Changes'
import { suggestedCoordinator } from './coordinatorChoice'
import { Accounts } from './Accounts'
import { Agents } from './Config'
import { NotFound, TaskRefused } from './errors'
import { taskShown } from './evidence'
import { Instance } from './Instance'
import { DraftUntitled, IssueDrafts, IssueTargetNeeded } from './IssueDrafts'
import { Issues } from './Issues'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { Plans } from './Plans'
import { finishedBy, listWords, type PullRequestFacts, sectionWords } from './pullRequestStanding'
import type { Policies } from './Policies'
import { Projects } from './Projects'
import { ReviewRefused, Reviews } from './Reviews'
import { findTasks, foundWords } from './Search'
import { notesSection, projectOverview } from './handover'
import { dropNote, keepNote, NOTE_LENGTH, NoteRefused, NOTES_KEPT, notesOf, sayNotes } from './notes'
import { envelope } from './envelope'
import { type PlanStep } from './Runs'
import { type Disposition, Sessions } from './Sessions'
import { blockedModelsOf } from './preferences'
import type { InputImage } from './sentImages'
import { SignIns } from './SignIns'
import { Tasks } from './Tasks'
import { addItem, transcript } from './threads'
import { ToolRefused, ToolServer, type Tool, type ToolAccess } from './ToolServer'
import { describeModels, type Route, routeTo, usableModels } from './usableModels'

/*
 * The project's coordinator (docs/architecture/04; docs/plans/mvp.md, "The
 * coordinator loop"): the agent you talk to about the project as a whole. It
 * answers questions itself, and turns changes into tasks with Althar's
 * tools, which it has as its only way to change anything. It starts when you
 * first say something to it, on the agent you last used.
 */

/** How long a task's title may be: it is read in a line, beside other things, on every screen. */
export const TITLE_LENGTH = 60

/** The coordinator couldn't start on the agent it would use, and the person picks another. */
export class CoordinatorUnavailable extends Schema.TaggedError<CoordinatorUnavailable>()('CoordinatorUnavailable', {
  agentId: Schema.String,
  agentName: Schema.String,
}) {}

export interface Suggested {
  readonly agentId: string
  readonly agentName: string
  readonly model: string | null
  readonly effort: string | null
  readonly available: boolean
}

type Store =
  | SqlClient.SqlClient
  | Instance
  | Agents
  | SignIns
  | Sessions
  | Projects
  | Plans
  | ToolServer
  | Ledger
  | Commands
  | Crypto.Crypto
  | Changes
  | Issues
  | IssueDrafts
  | Policies
  | Models
  | ModelFacts
  | Limits
  | Busy
  | Accounts
  | Reviews
  | Tasks

const Drafted = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  issue: Schema.optional(Schema.String),
  repositories: Schema.optional(Schema.Array(Schema.String)),
})
const Asked = Schema.Struct({ issue: Schema.String })
const DraftedIssue = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  tracker: Schema.optional(Schema.String),
  container: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(Schema.String)),
})
/*
 * A step's model, as list_models names it; or, as plans once did, an agent and its own id for the model. And how hard it
 * thinks, where named: one of the model's efforts as list_models writes them.
 */
const StepPick = Schema.Struct({
  model: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.NullOr(Schema.String)),
})
const Proposed = Schema.Struct({
  task: Schema.String,
  lead: Schema.Struct({ ...StepPick.fields, reason: Schema.optional(Schema.String) }),
  review: Schema.optional(Schema.NullOr(StepPick)),
})
/* A mini task: what to do, and the one model that does it. */
const Started = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  lead: Schema.Struct({ ...StepPick.fields, reason: Schema.optional(Schema.String) }),
  repositories: Schema.optional(Schema.Array(Schema.String)),
})
/* A pull request to review, by its link or number, and the model that reviews it. */
const ToReview = Schema.Struct({
  pull_request: Schema.Union([Schema.String, Schema.Number]),
  lead: Schema.Struct({ ...StepPick.fields, reason: Schema.optional(Schema.String) }),
})
const Named = Schema.Struct({ task: Schema.String })
/* A task, by its slug or id, and the title it is given now. */
const Retitled = Schema.Struct({ task_id: Schema.String, title: Schema.String })
const Sought = Schema.Struct({ text: Schema.String })
/* A thread to read: a task's, or, with none, the coordinator's own; and, to read further back, where the part read before began. */
const Reading = Schema.Struct({ task: Schema.optional(Schema.String), before: Schema.optional(Schema.Int) })
const Noted = Schema.Struct({ note: Schema.String })
const Dropped = Schema.Struct({ id: Schema.String })
const Passed = Schema.Struct({ task: Schema.String, message: Schema.String, now: Schema.optional(Schema.Boolean) })

const read = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
  )

export class Coordinator extends Context.Service<
  Coordinator,
  {
    /** The project's coordinator thread. */
    thread(projectId: string): Effect.Effect<string, unknown>
    /** The agent and model the coordinator starts on: the one you used last, and whether it is signed in. */
    suggested(projectId: string): Effect.Effect<Suggested | null, unknown>
    /**
     * Where its tools read how a task's pull requests stand, from the same reads the task's card is built from. Queries, which owns
     * them, sets it once built; undefined where it can't be told.
     */
    reading(read: (taskId: string) => Effect.Effect<PullRequestFacts | undefined>): Effect.Effect<void>
    /** Something the person says to the coordinator; the coordinator starts first if it isn't running. */
    say(input: {
      readonly envelope: CommandEnvelope
      readonly threadId: string
      readonly body: string
      readonly disposition: Disposition
      /** Images the person sent with it, in the store already: sent to the coordinator with its words. */
      readonly images?: ReadonlyArray<InputImage>
      /** Written by Althar for the person, such as an answer to a question the coordinator asked before it went: not shown as their message. */
      readonly quiet?: boolean
    }): Effect.Effect<void, unknown>
  }
>()('@althar/runtime/Coordinator') {
  static readonly layer: Layer.Layer<Coordinator, never, Store> = Layer.effect(
    Coordinator,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const agents = yield* Agents
      const sessions = yield* Sessions
      const projects = yield* Projects
      const plans = yield* Plans
      const busy = yield* Busy
      const toolServer = yield* ToolServer
      const changes = yield* Changes
      const issues = yield* Issues
      const issueDrafts = yield* IssueDrafts
      const reviews = yield* Reviews
      /* How a task's pull requests stand: set by Queries, which can read them (it needs this service, so this can't need it). */
      let pullRequests: (taskId: string) => Effect.Effect<PullRequestFacts | undefined> = () =>
        Effect.succeed({ changes: [], merged: [], unmerged: 0 })
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const nameOf = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId

      const thread = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ id: string }>`
            SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator' AND owner_actor_id = ${instance.personId}`
          return row === undefined ? yield* new NotFound({ kind: 'project', id: projectId }) : row.id
        })

      const suggested = (projectId: string) =>
        suggestedCoordinator(projectId).pipe(
          Effect.map((choice) => {
            if (choice === null) return null
            const { threadId: _threadId, ...pick } = choice
            return pick
          }),
        )

      const say = (input: {
        readonly envelope: CommandEnvelope
        readonly threadId: string
        readonly body: string
        readonly disposition: Disposition
        readonly images?: ReadonlyArray<InputImage>
        readonly quiet?: boolean
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{
            projectId: string
          }>`SELECT project_id FROM threads WHERE id = ${input.threadId} AND kind = 'coordinator'`
          if (row === undefined) return yield* new NotFound({ kind: 'thread', id: input.threadId })
          const running = yield* sessions.running(input.threadId)
          if (Option.isNone(running)) {
            const pick = yield* suggested(row.projectId)
            // What Althar tells it quietly (an answer to its question) waits for it, whether or not it can start now.
            if (input.quiet === true) yield* sessions.send(input)
            if (pick === null || !pick.available)
              return yield* new CoordinatorUnavailable({ agentId: pick?.agentId ?? '', agentName: pick?.agentName ?? 'The agent' })
            // Queued first, so the coordinator's first turn is its brief with what the person said.
            if (input.quiet !== true) yield* sessions.send(input)
            yield* sessions
              .start({
                threadId: input.threadId,
                agentId: pick.agentId,
                ...(pick.model === null ? {} : { model: pick.model }),
                ...(pick.effort === null ? {} : { effort: pick.effort }),
              })
              // One started meanwhile, as a fresh session taking the conversation over does: what was said waits for it.
              .pipe(Effect.catchTag('SessionRunning', () => Effect.void))
            return
          }
          yield* sessions.send(input)
        })

      /* ---- The coordinator's tools ---- */

      /** A task of this project, by its id or its slug. */
      const taskOf = (access: ToolAccess, reference: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ id: string; slug: string; title: string; description: string; state: string; threadId: string }>`
            SELECT k.id, k.slug, k.title, k.description, k.state, t.id AS thread_id
            FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.project_id = ${access.projectId} AND (k.id = ${reference} OR k.slug = ${reference})`
          return task === undefined
            ? yield* new ToolRefused({ message: `This project has no task ${reference}. list_tasks shows them.` })
            : task
        })

      const agentOf = (agentId: string) =>
        agents.list.some((entry) => entry.definition.id === agentId)
          ? Effect.succeed(agentId)
          : Effect.fail(
              new ToolRefused({
                message: `Althar has no agent ${agentId}. It has: ${agents.list.map((entry) => entry.definition.id).join(', ')}.`,
              }),
            )

      /** The project, as project_overview gives it: its repositories, its tasks, its rules, and its notes. */
      const overview = (access: ToolAccess) =>
        Effect.gen(function* () {
          return [yield* projectOverview(access.projectId), notesSection(yield* notesOf(access.projectId))].join('\n\n')
        })

      const list = (access: ToolAccess) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const tasks = yield* sql<{
            id: string
            slug: string
            title: string
            state: string
            run: string | null
            lead: string | null
            unbranched: number
          }>`
            SELECT k.id, k.slug, k.title, k.state,
              (SELECT r.state FROM runs r WHERE r.task_id = k.id ORDER BY r.created_at DESC LIMIT 1) AS run,
              EXISTS (SELECT 1 FROM workspaces w WHERE w.task_id = k.id AND w.branched_at IS NULL) AS unbranched,
              (SELECT s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
                WHERE t.task_id = k.id AND t.kind = 'task' ORDER BY s.started_at DESC LIMIT 1) AS lead
            FROM tasks k WHERE k.project_id = ${access.projectId} ORDER BY k.created_at DESC LIMIT 50`
          if (tasks.length === 0) return 'The project has no tasks yet.'
          const facts = yield* Effect.forEach(tasks, (task) => pullRequests(task.id), { concurrency: 4 })
          return tasks
            .map((task, at) => {
              // A done task was settled as merged, so no repository of it is left out.
              const found = task.state === 'done' && facts[at] !== undefined ? { ...facts[at], unmerged: 0 } : facts[at]
              // Whose pull requests are all merged (or closed, as far as Althar can tell) is finished, whatever its last run said; not
              // one with commits after them in none yet (ADR-034).
              const finished =
                task.state === 'done' && (found?.unshipped ?? 0) === 0
                  ? 'merged'
                  : (task.state === 'open' || task.state === 'done') && found !== undefined
                    ? finishedBy(found)
                    : null
              const state =
                task.state === 'draft'
                  ? 'planned'
                  : finished !== null
                    ? 'finished, merged'
                    : task.run === 'succeeded'
                      ? 'ready'
                      : task.state
              // A plain task that hasn't changed the repository has no branch, and nothing to ship.
              const words =
                task.unbranched === 1 ? 'no branch: it has changed nothing in the repository' : found === undefined ? '' : listWords(found)
              return `- ${task.slug}: ${task.title} (${state}${task.lead === null ? '' : `, led by ${nameOf(task.lead)}`})${words === '' ? '' : ` — ${words}`}`
            })
            .join('\n')
        })

      const find = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { text } = yield* read(Sought, input)
          if (text.trim() === '') return yield* new ToolRefused({ message: 'Say what to look for. list_tasks lists the newest tasks.' })
          const working = new Set((yield* sessions.onTasks).flatMap((session) => (session.turnRunning ? [session.taskId] : [])))
          return foundWords(text, yield* findTasks({ projectId: access.projectId, text, limit: 20 }, working))
        })

      const readTask = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { task: reference } = yield* read(Named, input)
          const task = yield* taskOf(access, reference)
          const results = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result' ORDER BY sequence`
          const workspaces = yield* sql<{ branch: string; path: string; name: string; branched: number }>`
            SELECT w.branch, w.path, b.display_name AS name, w.branched_at IS NOT NULL AS branched
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${task.id} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
          const seen = yield* pullRequests(task.id)
          const found = task.state === 'done' && seen !== undefined ? { ...seen, unmerged: 0 } : seen
          // What it built, as its lead last said it: what to tell the person it delivered, without reading every round.
          const { built, unverified } = yield* taskShown(task.threadId)
          return [
            `${task.slug}: ${task.title}`,
            task.description === '' ? '' : task.description,
            built === null ? '' : `What it built, as its lead says it now stands:\n${built}`,
            unverified.length === 0 ? '' : `What its lead couldn't show working:\n${unverified.map((line) => `- ${line}`).join('\n')}`,
            yield* issueWords(task.id),
            workspaces.length === 1
              ? `${upper(branchWords(workspaces[0]))}, in ${workspaces[0]?.path ?? ''}.`
              : workspaces.map((workspace) => `${workspace.name}: ${branchWords(workspace)}, in ${workspace.path}.`).join('\n'),
            ...results.map((row) => {
              const result = JSON.parse(row.content) as { step?: string; verdict?: string; summary?: string }
              return `${result.step ?? 'step'}${result.verdict === undefined ? '' : ` (${result.verdict})`}: ${result.summary ?? ''}`
            }),
            found === undefined ? 'Pull request: Althar could not read its state just now.' : sectionWords(found),
          ]
            .filter((line) => line !== '')
            .join('\n\n')
        })

      /** A task's branch in a repository, or that it has none yet: a plain task whose lead hasn't changed the repository. */
      const branchWords = (workspace: { readonly branch: string; readonly branched: number } | undefined) =>
        workspace === undefined || workspace.branched === 1
          ? `branch ${workspace?.branch ?? ''}`
          : 'no branch yet: its lead has changed nothing in the repository'
      const upper = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

      /** The issue a task came from, where it stands as last seen, and whether Althar moved it to In Progress as the task started. */
      const issueWords = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [link] = yield* sql<{ key: string; url: string; snapshot: string; type: string | null; payload: string | null }>`
            SELECT x.key, x.url, x.snapshot, e.type, e.payload FROM external_links x
            LEFT JOIN record_events e ON e.aggregate_id = x.id
              AND e.type IN ('external_link.issue_started', 'external_link.issue_start_failed')
            WHERE x.task_id = ${taskId} AND x.kind = 'issue' ORDER BY x.created_at, e.sequence DESC LIMIT 1`
          if (link === undefined) return ''
          const status = (JSON.parse(link.snapshot) as { status?: { name?: string } }).status?.name
          const said = JSON.parse(link.payload ?? '{}') as { moved?: boolean; error?: string }
          const issue = `Issue: ${link.key}${status === undefined ? '' : `, ${status}`}, ${link.url}.`
          if (link.type === 'external_link.issue_started' && said.moved === true)
            return `${issue} Althar moved it to In Progress as the task started: the person needn’t.`
          if (link.type === 'external_link.issue_start_failed')
            return `${issue} Althar couldn’t move it to In Progress as the task started: ${said.error ?? ''}.`
          return issue
        })

      /** A task's thread, or the coordinator's own conversation: its latest part, or the part before an earlier read. */
      const readThread = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { task: reference, before } = yield* read(Reading, input)
          const threadId = reference === undefined ? access.threadId : (yield* taskOf(access, reference)).threadId
          const record = yield* transcript(threadId, 30_000, {
            ...(before === undefined ? {} : { before }),
            // In its own conversation, what it said is its own.
            ...(reference === undefined ? { agent: 'you' } : {}),
          })
          if (record.text === '') return before === undefined ? 'The thread is empty.' : 'Nothing comes before that.'
          return record.omitted > 0
            ? `(The ${record.omitted} earliest items are left out: read_thread with before ${record.omitted} reads back from there.)\n${record.text}`
            : record.text
        })

      /** Keeps a decision the person made as one of the project's notes; the same words as one kept now are that note. */
      const keep = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { note } = yield* read(Noted, input)
          const kept = yield* keepNote({
            // A command of its own each time: the same words kept already are found as the note they are, and kept again once dropped.
            envelope: yield* envelope('project.note.keep', { note }, undefined, instance.coordinatorId),
            projectId: access.projectId as ProjectId,
            body: note,
          }).pipe(
            Effect.catchTag('NoteRefused', (refused: NoteRefused) =>
              Effect.fail(
                new ToolRefused({
                  message: {
                    empty: 'Say what the person decided, in a sentence.',
                    long: `That note is ${note.trim().length} characters. Keep it to ${NOTE_LENGTH}: the decision, in a sentence or two.`,
                    full: `The project keeps ${NOTES_KEPT} notes at most. Drop one that no longer holds with drop_note first; list_notes lists them.`,
                  }[refused.why],
                }),
              ),
            ),
          )
          return kept.kept ? `Kept as ${kept.noteId}.` : `The project has that note already, as ${kept.noteId}.`
        })

      const listNotes = (access: ToolAccess) =>
        Effect.map(notesOf(access.projectId), (notes) => (notes.length === 0 ? 'The project has no notes yet.' : sayNotes(notes)))

      const drop = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { id } = yield* read(Dropped, input)
          yield* dropNote({
            // Dropped already, a note stays dropped: dropping it again does nothing.
            envelope: yield* envelope('project.note.drop', { noteId: id }, undefined, instance.coordinatorId),
            projectId: access.projectId,
            noteId: id,
          }).pipe(
            Effect.catchTag('NotFound', () =>
              Effect.fail(new ToolRefused({ message: `The project has no note ${id}. list_notes lists them, by their ids.` })),
            ),
          )
          return `Dropped ${id}.`
        })

      /**
       * Drafts a task, from an issue where one is named: the task made, or the one this session made under that title before.
       * `plain`, for one started with no plan: its worktrees have no branch until its lead changes the repository.
       */
      const drafting = (access: ToolAccess, { title, description, issue: from, repositories }: typeof Drafted.Type, plain = false) =>
        Effect.gen(function* () {
          // A title is read at a glance, in a line on every screen: the rest of what was asked goes in the description.
          if (title.trim().length > TITLE_LENGTH)
            return yield* new ToolRefused({
              message: `That title is ${title.trim().length} characters. Keep it to ${TITLE_LENGTH}: what should change, in a few words. The rest belongs in the description.`,
            })
          // The issue it comes from is read first: its key goes in the task's branch.
          const issue =
            from === undefined
              ? undefined
              : yield* issues
                  .read(from, access.projectId)
                  .pipe(
                    Effect.mapError(
                      () => new ToolRefused({ message: `Althar can't read ${from}. Draft the task without it, or check the link.` }),
                    ),
                  )
          // What the person said in the turn the coordinator is on is what they asked for, not what they sent since: the task's thread starts with it.
          const sql = yield* SqlClient.SqlClient
          const said = yield* sql<{ body: string }>`
            SELECT u.body FROM turn_deliveries d JOIN turn_delivery_inputs di ON di.delivery_id = d.id JOIN user_inputs u ON u.id = di.user_input_id
            WHERE d.provider_session_id = ${access.sessionId}
              AND d.requested_at = (SELECT max(requested_at) FROM turn_deliveries WHERE provider_session_id = ${access.sessionId})
            ORDER BY di.position`
          const request = said.length === 0 ? undefined : said.map((input) => input.body).join('\n\n')
          // The same title from the same session is the same command: an agent that calls again, unsure the first worked, gets the first task.
          const commandId = `cmd_${createHash('sha256').update(`${access.sessionId}\u0000${title.trim().toLowerCase()}`).digest('hex').slice(0, 32)}`
          const created = yield* projects
            .createTask({
              envelope: yield* envelope('task.create', { title: title.trim().toLowerCase() }, commandId, instance.coordinatorId),
              projectId: access.projectId,
              title,
              ...(description === undefined ? {} : { description }),
              draft: true,
              ...(issue === undefined ? {} : { issueKey: issue.key }),
              ...(repositories === undefined ? {} : { repositories }),
              ...(request === undefined ? {} : { request }),
              ...(plain ? { plain } : {}),
            })
            .pipe(
              // A project of several repositories needs to hear which the task changes: said so, with the ones it has.
              Effect.catchTag('RepositoriesNeeded', (needed) =>
                Effect.fail(
                  new ToolRefused({
                    message:
                      needed.unknown.length > 0
                        ? `The project has no repository called ${needed.unknown.join(' or ')}. Its repositories: ${needed.choices.join(', ')}.`
                        : `Say which of the project's repositories the task changes, as repositories: ${needed.choices.join(', ')}.`,
                  }),
                ),
              ),
            )
          if (issue !== undefined && from !== undefined)
            yield* issues.attach({ projectId: access.projectId as ProjectId, taskId: created.taskId, issue: from })
          return { created, issue }
        })

      const draft = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { created, issue } = yield* drafting(access, yield* read(Drafted, input))
          return `Drafted ${created.slug}${issue === undefined ? '' : `, from ${issue.key}`}. Now propose its plan with propose_plan.`
        })

      /**
       * A mini task: drafted and started in one go, with no plan for the
       * person to look over. One lead, no review, and nothing outside the
       * project when it is done; the person sees it as a card, already
       * running. It is a plain task: its worktree has no branch until its
       * lead changes the repository (DEV-96).
       */
      const startNow = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { lead: pick, ...drafted } = yield* read(Started, input)
          // The lead is found first, so a model that can't be used drafts nothing.
          const lead = yield* stepOf(access.projectId, pick)
          const { created } = yield* drafting(access, drafted, true)
          // Called again, unsure the first worked, it doesn't start the same task twice.
          if ((yield* taskOf(access, created.taskId)).state !== 'draft') return `${created.slug} has started already.`
          const planId = yield* plans.propose({
            projectId: access.projectId as ProjectId,
            taskId: created.taskId,
            steps: [{ key: 'implement', ...lead, skipped: false }],
            reason: pick.reason ?? null,
            actorId: instance.coordinatorId,
            end: null,
            held: true,
          })
          const started = yield* plans.start(planId, instance.coordinatorId)
          if (started === 'waiting') {
            const { busy: atWork, atOnce } = yield* busy.now
            return `Started ${created.slug}, but it waits for a free agent: ${atWork} of the ${atOnce} this computer runs at once are busy. Its lead starts on it by itself when one is free, with no review, and nothing goes outside the project when it is done. The person sees it as a card, waiting; say in a sentence what it does, and that it waits its turn.`
          }
          return `Started ${created.slug}: its lead is on it now, with no review, and nothing goes outside the project when it is done. The person sees it as a card; say in a sentence what it does.`
        })

      /**
       * A review of someone else's pull request: a task whose lead reads a
       * read-only copy of it and drafts a review, which the person posts.
       * Asked again, it says the task already reviewing it.
       */
      const review = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(ToReview, input)
          const lead = yield* stepOf(access.projectId, asked.lead)
          const pullRequest = String(asked.pull_request).trim()
          // What the person said in the turn the coordinator is on is what they asked for: the task's thread opens with it.
          const sql = yield* SqlClient.SqlClient
          const said = yield* sql<{ body: string }>`
            SELECT u.body FROM turn_deliveries d JOIN turn_delivery_inputs di ON di.delivery_id = d.id JOIN user_inputs u ON u.id = di.user_input_id
            WHERE d.provider_session_id = ${access.sessionId}
              AND d.requested_at = (SELECT max(requested_at) FROM turn_deliveries WHERE provider_session_id = ${access.sessionId})
            ORDER BY di.position`
          // The same pull request from the same session is the same command: called again, unsure the first worked, it starts nothing twice.
          const commandId = `cmd_${createHash('sha256').update(`${access.sessionId}\u0000review\u0000${pullRequest.toLowerCase()}`).digest('hex').slice(0, 32)}`
          const started = yield* reviews
            .start({
              envelope: yield* envelope('task.review', { pullRequest: pullRequest.toLowerCase() }, commandId, instance.coordinatorId),
              projectId: access.projectId as ProjectId,
              pullRequest,
              lead: { agentId: lead.agentId, model: lead.model, ...(lead.effort === undefined ? {} : { effort: lead.effort }) },
              ...(said.length === 0 ? {} : { request: said.map((input) => input.body).join('\n\n') }),
            })
            .pipe(
              Effect.catch((error) => Effect.fail(error instanceof ReviewRefused ? new ToolRefused({ message: error.message }) : error)),
            )
          if (started.already)
            return `${started.slug} already reviews ${started.author}'s ${started.name}; message its lead to ask it more.`
          const reach = started.outside
            ? `It comes from outside the project, so its lead reads it with no network, and Approve is the person's to choose.`
            : `${started.author} is one of the repository's people.`
          const posting = started.posts
            ? "The person has their team's reviews posted without asking, so it posts itself once drafted."
            : 'Nothing is posted until the person posts it from its card.'
          if (!started.leading)
            return `Started ${started.slug} to review ${started.author}'s ${started.name}, "${started.title}", but its lead couldn't start: its thread says why, and the person starts another there. Tell them.`
          return `Started ${started.slug}: its lead reviews ${started.author}'s ${started.name}, "${started.title}", from a read-only copy of its code, running nothing of it. ${reach} ${posting} The person sees it as a card; say in a sentence that it's under way.`
        })

      /**
       * Gives a task another title, as the person can: for one whose work
       * became a change (a plain task whose lead changed the repository), when
       * its title no longer says what it does. Its slug and branch stay, and
       * what the person asked stays in its thread.
       */
      const renameTask = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { task_id: reference, title } = yield* read(Retitled, input)
          const task = yield* taskOf(access, reference)
          yield* (yield* Tasks)
            .rename({
              envelope: yield* envelope('task.rename', { taskId: task.id, title: title.trim() }, undefined, instance.coordinatorId),
              taskId: task.id,
              title,
            })
            .pipe(
              Effect.catch((error) =>
                error instanceof TaskRefused
                  ? Effect.fail(
                      new ToolRefused({
                        message:
                          error.why === 'title_too_long'
                            ? `That title is ${title.trim().length} characters. Keep it to ${TITLE_LENGTH}: what the task does, in a few words.`
                            : 'Give it a title: what the task does, in a few words.',
                      }),
                    )
                  : Effect.fail(error),
              ),
            )
          return title.trim() === task.title
            ? `${task.slug} is called that already.`
            : `Renamed ${task.slug} to “${title.trim()}”. Its slug and branch stay as they were; the person sees the new title on its card.`
        })

      /** The models the coordinator can give work to in the project, as it reads them. */
      const listModels = (access: ToolAccess) => Effect.map(usableModels(access.projectId), describeModels)

      /**
       * A step's effort, where the plan names one: one of the levels its model
       * takes the way it goes, by its id or its name, kept as its id. Any other
       * is refused, with the ones it takes. Left out, the step starts at the
       * person's default for the model, or else at the model's own.
       */
      const effortOf = (
        named: string,
        levels: ReadonlyArray<{ readonly id: string; readonly name: string }>,
        asked: string | null | undefined,
      ): Effect.Effect<string | null, ToolRefused> => {
        if (asked == null) return Effect.succeed(null)
        const wanted = asked.trim().toLowerCase()
        const level = levels.find((one) => one.id.toLowerCase() === wanted || one.name.toLowerCase() === wanted)
        if (level !== undefined) return Effect.succeed(level.id)
        return Effect.fail(
          new ToolRefused({
            message:
              levels.length === 0
                ? `${named} has no effort to set. Leave effort out.`
                : `${named} has no effort ${asked}. Name one of its efforts, as list_models writes them: ${levels.map((one) => one.id).join(', ')}; or leave effort out.`,
          }),
        )
      }

      /**
       * A step's agent, model and effort, from what the plan names (ADR-015):
       * a model as list_models writes it, taken the best way there is; or an
       * agent, on its own id for a model or on its own default.
       */
      const stepOf = (projectId: string, pick: typeof StepPick.Type) =>
        Effect.gen(function* () {
          // On the way it goes, at an effort that model takes there; named as the plan names it.
          const on = (route: Route, named: string) =>
            Effect.map(effortOf(named, route.efforts, pick.effort), (effort) => ({
              agentId: route.agentId,
              model: route.model,
              ...(effort === null ? {} : { effort }),
            }))
          if (pick.model !== undefined) {
            const route = routeTo(yield* usableModels(projectId), pick.model, pick.agent)
            if (route !== null) return yield* on(route, pick.model)
            if (pick.agent === undefined)
              return yield* new ToolRefused({
                message: `No model called ${pick.model} can be used now. ${describeModels(yield* usableModels(projectId))}`,
              })
          }
          if (pick.agent === undefined) return yield* new ToolRefused({ message: 'Name the model, as list_models writes it.' })
          const agentId = yield* agentOf(pick.agent)
          // Named the old way, by agent, a model the person switched off is still off: the same model another way, by the name people know it by, or none.
          if (pick.model !== undefined && (yield* blockedModelsOf(agentId)).includes(pick.model)) {
            const offered = (yield* (yield* Models).catalog)
              .find((one) => one.agentId === agentId)
              ?.models.find((model) => model.id === pick.model)
            const agentName = agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId
            const elsewhere =
              offered === undefined
                ? null
                : routeTo(yield* usableModels(projectId), knownModelName({ id: agentId, name: agentName }, offered))
            if (elsewhere !== null) return yield* on(elsewhere, pick.model)
            return yield* new ToolRefused({
              message: `The person switched ${pick.model} off. ${describeModels(yield* usableModels(projectId))}`,
            })
          }
          // Its efforts as the agent offers that model; on its own default, they aren't known, so none is taken.
          const levels =
            pick.effort == null || pick.model === undefined
              ? []
              : ((yield* (yield* Models).catalog).find((one) => one.agentId === agentId)?.models.find((model) => model.id === pick.model)
                  ?.efforts ?? [])
          const effort = yield* effortOf(pick.model ?? `${nameOf(agentId)}'s default model`, levels, pick.effort)
          return { agentId, model: pick.model ?? null, ...(effort === null ? {} : { effort }) }
        })

      const propose = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const proposed = yield* read(Proposed, input)
          const task = yield* taskOf(access, proposed.task)
          if (task.state !== 'draft')
            return yield* new ToolRefused({ message: `${task.slug} has started already; message its lead instead.` })
          const steps: Array<PlanStep> = [{ key: 'implement', ...(yield* stepOf(access.projectId, proposed.lead)), skipped: false }]
          if (proposed.review !== null && proposed.review !== undefined)
            steps.push({ key: 'review', ...(yield* stepOf(access.projectId, proposed.review)), skipped: false })
          yield* plans.propose({
            projectId: access.projectId as ProjectId,
            taskId: task.id,
            steps,
            reason: proposed.lead.reason ?? null,
            actorId: instance.coordinatorId,
            end: yield* changes.endFor(access.projectId, task.id),
          })
          return `Planned ${task.slug}. It starts in 25 seconds unless the person holds or changes it; they see it as a card, so there's no need to describe the plan again.`
        })

      const message = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { task: reference, message: body, now } = yield* read(Passed, input)
          const task = yield* taskOf(access, reference)
          const lead = yield* sessions.running(task.threadId)
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: task.threadId, body }, undefined, instance.coordinatorId),
            threadId: task.threadId,
            body: `The coordinator passes this on:\n\n${body}`,
            disposition: now === true ? 'interrupt_and_continue' : 'after_current',
            quiet: true,
          })
          yield* addItem({ projectId: access.projectId as ProjectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: 'From the coordinator:',
            description: body,
          })
          // Queued for a lead that isn't running, it waits until one starts: the coordinator says so to the person.
          return Option.isSome(lead)
            ? `Passed on to ${task.slug}'s lead.`
            : `No lead is running on ${task.slug}, so nobody reads this yet; its lead will when one starts. Tell the person.`
        })

      const readIssue = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { issue: wanted } = yield* read(Asked, input)
          const issue = yield* issues
            .read(wanted, access.projectId)
            .pipe(Effect.mapError(() => new ToolRefused({ message: `Althar can't read ${wanted}: no connected tracker has it.` })))
          return [
            `${issue.key}: ${issue.title}`,
            `${issue.status.name}${issue.priority === null || issue.priority.level === 'none' ? '' : `, ${issue.priority.name} priority`}${issue.container === null ? '' : `, in ${issue.container}`}. ${issue.url}`,
            issue.body === '' ? 'No description.' : issue.body,
          ].join('\n\n')
        })

      const findIssues = (access: ToolAccess) =>
        Effect.gen(function* () {
          const found = yield* issues.mine(access.projectId)
          if (found.length === 0) return 'The person has no open issues on the connected trackers.'
          return found.map((issue) => `- ${issue.key}: ${issue.title} (${issue.status.name}) ${issue.url}`).join('\n')
        })

      /**
       * Drafts an issue on a connected tracker, and files nothing: the person
       * sees it as a card and files it, changes it or discards it there.
       */
      const draftIssue = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* read(DraftedIssue, input)
          const card = yield* issueDrafts
            .draft({
              projectId: access.projectId as ProjectId,
              threadId: access.threadId,
              ...(asked.tracker === undefined ? {} : { tracker: asked.tracker }),
              ...(asked.container === undefined ? {} : { container: asked.container }),
              title: asked.title,
              body: asked.description ?? '',
              labels: asked.labels ?? [],
              actorId: instance.coordinatorId,
            })
            .pipe(
              Effect.catch((error) => {
                if (error instanceof DraftUntitled) return Effect.fail(new ToolRefused({ message: 'Give the issue a title.' }))
                if (error instanceof ConnectorFailed)
                  return Effect.fail(new ToolRefused({ message: `Althar couldn't ask the tracker where issues go: ${error.message}` }))
                if (!(error instanceof IssueTargetNeeded)) return Effect.fail(error)
                const choices = error.choices.join(', ')
                const where = error.tracker ?? 'that tracker'
                switch (error.reason) {
                  case 'no_tracker':
                    return Effect.fail(
                      new ToolRefused({
                        message:
                          'The person has no tracker connected to Althar, so there is nowhere to draft an issue. They connect one in Settings.',
                      }),
                    )
                  case 'tracker_needed':
                    return Effect.fail(new ToolRefused({ message: `Say which tracker it goes on, as tracker: ${choices}.` }))
                  case 'unknown_tracker':
                    return Effect.fail(
                      new ToolRefused({ message: `No tracker called ${error.named ?? ''} is connected. Connected: ${choices}.` }),
                    )
                  case 'container_needed':
                    return Effect.fail(new ToolRefused({ message: `Say where on ${where} it goes, as container: ${choices}.` }))
                  case 'unknown_container':
                    return Effect.fail(
                      new ToolRefused({
                        message:
                          error.tracker === null
                            ? `No connected tracker has anywhere called ${error.named ?? ''} for issues. They have: ${choices}.`
                            : error.choices.length === 0
                              ? `This account can't file issues anywhere on ${where}.`
                              : `${where} has nowhere called ${error.named ?? ''} for issues. It has: ${choices}.`,
                      }),
                    )
                }
              }),
            )
          return `Drafted the issue “${card.title}” on ${card.tracker}, in ${card.container}. Nothing is filed until the person files it from its card, where they can change it or discard it; they see it there, so there's no need to repeat it. You'll hear what they decide.`
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
                    Effect.logWarning('A coordinator tool did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not do that. Try again, or tell the person.' })),
                  ),
            ),
          ),
      })
      const nothing = { type: 'object', properties: {} }
      const named = {
        type: 'object',
        properties: { task: { type: 'string', description: "The task's slug, as list_tasks shows it." } },
        required: ['task'],
      }
      const effort = {
        type: 'string',
        description:
          "How hard it thinks: one of the efforts list_models gives for its model. Left out, it starts at the person's default for the model, or else at the model's own.",
      }

      yield* toolServer.serve('coordinator', [
        tool('project_overview', 'The project: its repositories, how many tasks it has, its rules, and its notes.', nothing, (access) =>
          overview(access),
        ),
        tool(
          'list_tasks',
          "The project's tasks, newest first: what each is, where it stands, who leads it, and, after a dash, how its pull request stands as Althar last saw it: draft or ready for review, checks, commits not pushed yet, merged or closed. A merged pull request is finished: don't suggest merging it. A closed one is as last seen only, since Althar stops watching it and it may have been reopened: say so rather than calling the task finished.",
          nothing,
          (access) => list(access),
        ),
        tool(
          'find_tasks',
          "Finds the project's tasks by what they were about: words from a title, what the person asked, what a lead reported or built, a pull request's number (#143), an issue's key, a branch, or a file's name. Each word finds the words it begins, and a task must hold them all. Best first: each with where it stands, its pull request and its id, and the words that matched. For a task asked about by what it did rather than its name.",
          {
            type: 'object',
            properties: { text: { type: 'string', description: 'What to look for, in a few words.' } },
            required: ['text'],
          },
          find,
        ),
        tool(
          'read_task',
          "A task: what it is, what it built as its lead last said it (and what it couldn't show working), its branch, what each of its steps reported, and its pull request: link, checks (passing, failing with names, pending), commits not pushed yet, when it was merged or closed, and what isn't known or may be out of date.",
          named,
          readTask,
        ),
        tool(
          'read_thread',
          "A thread as text, oldest first: a task's, with what the person, its lead and Althar said; or, without a task, your own conversation with the person. It reads the latest part; to read further back, pass before as it says.",
          {
            type: 'object',
            properties: {
              task: { type: 'string', description: "The task's slug, as list_tasks shows it. Leave it out for your own conversation." },
              before: { type: 'integer', description: 'To read further back: the number an earlier read_thread gave.' },
            },
          },
          readThread,
        ),
        tool(
          'draft_task',
          `Drafts a task for a change: its title, saying what should change in a few words (at most ${TITLE_LENGTH} characters), and a description with what the lead needs: the context, where to look, constraints, and what done looks like. When it comes from an issue, pass the issue's link or key as issue. Then propose its plan.`,
          {
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: TITLE_LENGTH },
              description: { type: 'string' },
              issue: { type: 'string', description: 'The issue it comes from: its link, or its key (MER-231, #12).' },
              repositories: {
                type: 'array',
                items: { type: 'string' },
                description:
                  "The project's repositories the task changes, by name. Needed only in a project of several; the lead can still read the others.",
              },
            },
            required: ['title'],
          },
          draft,
        ),
        tool(
          'read_issue',
          'An issue on a connected tracker, or in the project’s repository: its title, status and description. Takes its link or its key.',
          { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] },
          readIssue,
        ),
        tool(
          'find_issues',
          'The person’s open issues on the connected trackers, and in the project’s repository, newest change first.',
          nothing,
          (access) => findIssues(access),
        ),
        tool(
          'draft_issue',
          "Drafts an issue on one of the person's connected trackers, for something to track rather than do now: a bug found, follow-up work, an idea. It files nothing: the person sees it as a card, and files it, changes it or discards it. Give it a title and a description in Markdown with what whoever picks it up needs. Without tracker and container, it goes where the project's issues come from, or its repository's issues; when that isn't clear, Althar says what to name.",
          {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string', description: 'Markdown.' },
              tracker: {
                type: 'string',
                description:
                  'The tracker, by name: Linear, Jira, Trello, GitHub, GitLab; where two connections share a name, as Althar names them, or by site.',
              },
              container: {
                type: 'string',
                description:
                  "Where on the tracker: a Linear team's key, a Jira project's key, a Trello list as Board / List, a repository as owner/name.",
              },
              labels: { type: 'array', items: { type: 'string' }, description: 'Labels the tracker has; others are left off.' },
            },
            required: ['title'],
          },
          draftIssue,
        ),
        tool(
          'list_models',
          'The models you can give work to now, by who makes them, with how each scores, whether a plan pays for it, and the efforts it takes: their ids, the one it starts at by itself, and the person’s default where they set one.',
          nothing,
          (access) => listModels(access),
        ),
        tool(
          'propose_plan',
          "Proposes a drafted task's plan: the model that implements it (its lead), with why in a sentence; and the model that reviews it, which only reads, or null for something trivial. Name each model as list_models writes it, and, where it matters, one of the efforts it lists for that model. It starts on its own after 25 seconds unless the person holds or changes it.",
          {
            type: 'object',
            properties: {
              task: { type: 'string', description: "The task's slug." },
              lead: {
                type: 'object',
                properties: { model: { type: 'string', description: 'As list_models writes it.' }, effort, reason: { type: 'string' } },
                required: ['model'],
              },
              review: {
                type: ['object', 'null'],
                properties: {
                  model: { type: 'string', description: 'As list_models writes it; another maker’s than the lead’s where there is one.' },
                  effort,
                },
                required: ['model'],
              },
            },
            required: ['task', 'lead'],
          },
          propose,
        ),
        tool(
          'start_task',
          `Starts something small at once, without a plan: trying something out, checking how something behaves, a quick look that needs the project's tools. One lead you pick, as list_models writes it, and an effort it lists where it matters; no review, nothing published, and no wait. Give it a title (at most ${TITLE_LENGTH} characters) and what the lead needs to know. It starts with no branch; if its lead changes the repository, Althar puts that on a branch of its own and the task is a change from then. A change worth reviewing, or that should end in a pull request, is draft_task and propose_plan instead; to try what a task has built, ask its lead with message_lead.`,
          {
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: TITLE_LENGTH },
              description: { type: 'string' },
              lead: {
                type: 'object',
                properties: { model: { type: 'string', description: 'As list_models writes it.' }, effort, reason: { type: 'string' } },
                required: ['model'],
              },
              repositories: {
                type: 'array',
                items: { type: 'string' },
                description: "The project's repositories it works in, by name. Needed only in a project of several.",
              },
            },
            required: ['title', 'lead'],
          },
          startNow,
        ),
        tool(
          'review_pull_request',
          "Starts a review of a pull request, when the person asks for one or pastes a pull request's link and asks: by its link, or its number in the project's repository (#123). Its lead, the model you pick as list_models writes it (a strong one), reads a read-only copy of the pull request's code, runs nothing of it, and drafts a review the person posts from its card. Nothing reaches the code host until they do. Don't review it yourself.",
          {
            type: 'object',
            properties: {
              pull_request: { type: 'string', description: 'Its link, or its number in the project’s repository: #123.' },
              lead: {
                type: 'object',
                properties: { model: { type: 'string', description: 'As list_models writes it.' }, effort, reason: { type: 'string' } },
                required: ['model'],
              },
            },
            required: ['pull_request', 'lead'],
          },
          review,
        ),
        tool(
          'rename_task',
          `Gives a task another title, at most ${TITLE_LENGTH} characters, as the person can. For a task whose work became a change, such as a plain task whose lead started changing the repository, when its title no longer says what it does: say what it does now, in a few words. What the person asked stays in its thread, and its slug and branch stay as they are.`,
          {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: "The task's slug, as list_tasks shows it, or its id." },
              title: { type: 'string', maxLength: TITLE_LENGTH },
            },
            required: ['task_id', 'title'],
          },
          renameTask,
        ),
        tool(
          'message_lead',
          "Passes a message to a task's lead: after its current turn, or at once with now.",
          {
            type: 'object',
            properties: { task: { type: 'string' }, message: { type: 'string' }, now: { type: 'boolean' } },
            required: ['task', 'message'],
          },
          message,
        ),
        tool(
          'keep_note',
          `Keeps one of the project's notes: a decision the person made in conversation that the code doesn't show, in a sentence (at most ${NOTE_LENGTH} characters), such as "Issue drafts need an approval card, on every tracker." Every session of yours starts with the project's notes, and the person sees them in the project's settings.`,
          { type: 'object', properties: { note: { type: 'string', maxLength: NOTE_LENGTH } }, required: ['note'] },
          keep,
        ),
        tool('list_notes', "The project's notes, oldest first, each with its id.", nothing, (access) => listNotes(access)),
        tool(
          'drop_note',
          "Drops one of the project's notes that no longer holds, such as a decision the person took back, by its id as list_notes gives it.",
          { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          drop,
        ),
      ])

      return Coordinator.of({
        thread: (projectId) => provide(thread(projectId)),
        suggested: (projectId) => provide(suggested(projectId)),
        say: (input) => provide(say(input)),
        reading: (read) =>
          Effect.sync(() => {
            pullRequests = read
          }),
      })
    }),
  )
}
