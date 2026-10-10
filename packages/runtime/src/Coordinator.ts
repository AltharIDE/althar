import { createHash } from 'node:crypto'

import { type CommandEnvelope, type ProjectId } from '@althar/domain'
import type { Commands, Ledger } from '@althar/persistence-sqlite'
import { knownModelName } from '@althar/contracts'
import { Context, type Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from './Changes'
import { Accounts } from './Accounts'
import { Agents } from './Config'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { Issues } from './Issues'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { Plans } from './Plans'
import { Policies, ruleSetOf } from './Policies'
import { Projects } from './Projects'
import { sayRules } from './rules'
import { envelope } from './envelope'
import { type PlanStep } from './Runs'
import { type Disposition, Sessions } from './Sessions'
import { blockedModelsOf } from './preferences'
import { withRole } from './roles'
import { SignIns } from './SignIns'
import { addItem, transcript } from './threads'
import { ToolRefused, ToolServer, type Tool, type ToolAccess } from './ToolServer'
import { describeModels, routeTo, usableModels } from './usableModels'

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
  | Policies
  | Models
  | ModelFacts
  | Limits
  | Accounts

const Drafted = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  issue: Schema.optional(Schema.String),
  repositories: Schema.optional(Schema.Array(Schema.String)),
})
const Asked = Schema.Struct({ issue: Schema.String })
/* A step's model, as list_models names it; or, as plans once did, an agent and its own id for the model. */
const StepPick = Schema.Struct({ model: Schema.optional(Schema.String), agent: Schema.optional(Schema.String) })
const Proposed = Schema.Struct({
  task: Schema.String,
  lead: Schema.Struct({ ...StepPick.fields, reason: Schema.optional(Schema.String) }),
  review: Schema.optional(Schema.NullOr(StepPick)),
})
const Named = Schema.Struct({ task: Schema.String })
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
    /** Something the person says to the coordinator; the coordinator starts first if it isn't running. */
    say(input: {
      readonly envelope: CommandEnvelope
      readonly threadId: string
      readonly body: string
      readonly disposition: Disposition
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
      const signIns = yield* SignIns
      const toolServer = yield* ToolServer
      const changes = yield* Changes
      const issues = yield* Issues
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const nameOf = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId

      const thread = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ id: string }>`
            SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator' AND owner_actor_id = ${instance.personId}`
          return row === undefined ? yield* new NotFound({ kind: 'project', id: projectId }) : row.id
        })

      /** Whatever the person used last: the coordinator's own last agent here, or the last agent anywhere. */
      const suggested = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const threadId = yield* thread(projectId)
          const [here] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
            SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC LIMIT 1`
          const [anywhere] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
            SELECT agent_id, model, effort FROM provider_sessions ORDER BY started_at DESC LIMIT 1`
          const last = here ?? anywhere
          const agentId =
            last !== undefined && agents.list.some((entry) => entry.definition.id === last.agentId)
              ? last.agentId
              : agents.list[0]?.definition.id
          if (agentId === undefined) return null
          const status = yield* signIns.of(agentId)
          // The last model used, unless the person switched it off since.
          const blocked = yield* blockedModelsOf(agentId)
          const again = last?.agentId === agentId && (last.model === null || !blocked.includes(last.model)) ? last : null
          return {
            agentId,
            agentName: nameOf(agentId),
            model: again?.model ?? null,
            effort: again?.effort ?? null,
            available: status !== 'signed_out',
          } satisfies Suggested
        })

      const say = (input: {
        readonly envelope: CommandEnvelope
        readonly threadId: string
        readonly body: string
        readonly disposition: Disposition
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
            if (pick === null || !pick.available)
              return yield* new CoordinatorUnavailable({ agentId: pick?.agentId ?? '', agentName: pick?.agentName ?? 'The agent' })
            // Queued first, so the coordinator's first turn is its brief with what the person said.
            yield* sessions.send({ envelope: input.envelope, threadId: input.threadId, body: input.body, disposition: input.disposition })
            yield* sessions.start({
              threadId: input.threadId,
              agentId: pick.agentId,
              ...(pick.model === null ? {} : { model: pick.model }),
              ...(pick.effort === null ? {} : { effort: pick.effort }),
            })
            return
          }
          yield* sessions.send({ envelope: input.envelope, threadId: input.threadId, body: input.body, disposition: input.disposition })
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

      const overview = (access: ToolAccess) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${access.projectId}`
          const repositories = yield* sql<{ name: string; role: string; base: string | null; within: string | null; path: string }>`
            SELECT b.display_name AS name, b.role, b.default_base_ref AS base, b.folder AS within, l.path FROM repository_bindings b
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.project_id = ${access.projectId} AND b.detached_at IS NULL
            ORDER BY b.created_at, b.rowid`
          const [counts] = yield* sql<{ open: number; drafts: number }>`
            SELECT sum(state = 'open') AS open, sum(state = 'draft') AS drafts FROM tasks WHERE project_id = ${access.projectId}`
          return [
            `Project: ${project?.name ?? ''}`,
            `Repositories:\n${repositories
              .map(
                (repository) =>
                  `- ${withRole(repository.name, repository.role)} (${repository.base ?? 'main'}), on this Mac at ${repository.path}${repository.within === null ? '' : `; the project is its folder ${repository.within}`}`,
              )
              .join('\n')}`,
            `Tasks: ${counts?.open ?? 0} open, ${counts?.drafts ?? 0} planned and not yet started.`,
            `Rules: ${sayRules(ruleSetOf((yield* (yield* Policies).current(access.projectId as ProjectId)).rules))}`,
          ].join('\n\n')
        })

      const list = (access: ToolAccess) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const tasks = yield* sql<{ slug: string; title: string; state: string; run: string | null; lead: string | null }>`
            SELECT k.slug, k.title, k.state,
              (SELECT r.state FROM runs r WHERE r.task_id = k.id ORDER BY r.created_at DESC LIMIT 1) AS run,
              (SELECT s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
                WHERE t.task_id = k.id AND t.kind = 'task' ORDER BY s.started_at DESC LIMIT 1) AS lead
            FROM tasks k WHERE k.project_id = ${access.projectId} ORDER BY k.created_at DESC LIMIT 50`
          if (tasks.length === 0) return 'The project has no tasks yet.'
          return tasks
            .map(
              (task) =>
                `- ${task.slug}: ${task.title} (${task.state === 'draft' ? 'planned' : task.run === 'succeeded' ? 'ready' : task.state}${task.lead === null ? '' : `, led by ${nameOf(task.lead)}`})`,
            )
            .join('\n')
        })

      const readTask = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { task: reference } = yield* read(Named, input)
          const task = yield* taskOf(access, reference)
          const results = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result' ORDER BY sequence`
          const workspaces = yield* sql<{ branch: string; path: string; name: string }>`
            SELECT w.branch, w.path, b.display_name AS name FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${task.id} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
          return [
            `${task.slug}: ${task.title}`,
            task.description === '' ? '' : task.description,
            workspaces.length === 1
              ? `Branch ${workspaces[0]?.branch ?? ''}, in ${workspaces[0]?.path ?? ''}.`
              : workspaces.map((workspace) => `${workspace.name}: branch ${workspace.branch}, in ${workspace.path}.`).join('\n'),
            ...results.map((row) => {
              const result = JSON.parse(row.content) as { step?: string; verdict?: string; summary?: string }
              return `${result.step ?? 'step'}${result.verdict === undefined ? '' : ` (${result.verdict})`}: ${result.summary ?? ''}`
            }),
          ]
            .filter((line) => line !== '')
            .join('\n\n')
        })

      const readThread = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { task: reference } = yield* read(Named, input)
          const task = yield* taskOf(access, reference)
          const record = yield* transcript(task.threadId, 30_000)
          return record.omitted > 0
            ? `(The ${record.omitted} earliest items are left out.)\n${record.text}`
            : record.text || 'The thread is empty.'
        })

      const draft = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const { title, description, issue: from, repositories } = yield* read(Drafted, input)
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
          return `Drafted ${created.slug}${issue === undefined ? '' : `, from ${issue.key}`}. Now propose its plan with propose_plan.`
        })

      /** The models the coordinator can give work to in the project, as it reads them. */
      const listModels = (access: ToolAccess) => Effect.map(usableModels(access.projectId), describeModels)

      /**
       * A step's agent and model, from what the plan names (ADR-015): a model
       * as list_models writes it, taken the best way there is; or an agent, on
       * its own id for a model or on its own default.
       */
      const stepOf = (projectId: string, pick: typeof StepPick.Type) =>
        Effect.gen(function* () {
          if (pick.model !== undefined) {
            const route = routeTo(yield* usableModels(projectId), pick.model, pick.agent)
            if (route !== null) return { agentId: route.agentId, model: route.model }
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
            if (elsewhere !== null) return { agentId: elsewhere.agentId, model: elsewhere.model }
            return yield* new ToolRefused({
              message: `The person switched ${pick.model} off. ${describeModels(yield* usableModels(projectId))}`,
            })
          }
          return { agentId, model: pick.model ?? null }
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

      yield* toolServer.serve('coordinator', [
        tool('project_overview', 'The project: its repositories, how many tasks it has, and its rules.', nothing, (access) =>
          overview(access),
        ),
        tool('list_tasks', "The project's tasks, newest first: what each is, where it stands, and who leads it.", nothing, (access) =>
          list(access),
        ),
        tool('read_task', 'A task: what it is, its branch, and what each of its steps reported.', named, readTask),
        tool('read_thread', "A task's thread as text: what the person, the lead and Althar said, oldest first.", named, readThread),
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
          'list_models',
          'The models you can give work to now, by who makes them, with how each scores and whether a plan pays for it.',
          nothing,
          (access) => listModels(access),
        ),
        tool(
          'propose_plan',
          "Proposes a drafted task's plan: the model that implements it (its lead), with why in a sentence; and the model that reviews it, which only reads, or null for something trivial. Name each model as list_models writes it. It starts on its own after 25 seconds unless the person holds or changes it.",
          {
            type: 'object',
            properties: {
              task: { type: 'string', description: "The task's slug." },
              lead: {
                type: 'object',
                properties: { model: { type: 'string', description: 'As list_models writes it.' }, reason: { type: 'string' } },
                required: ['model'],
              },
              review: {
                type: ['object', 'null'],
                properties: {
                  model: { type: 'string', description: 'As list_models writes it; another maker’s than the lead’s where there is one.' },
                },
                required: ['model'],
              },
            },
            required: ['task', 'lead'],
          },
          propose,
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
      ])

      return Coordinator.of({
        thread: (projectId) => provide(thread(projectId)),
        suggested: (projectId) => provide(suggested(projectId)),
        say: (input) => provide(say(input)),
      })
    }),
  )
}
