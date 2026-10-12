import type { ProjectId } from '@althar/domain'
import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { endWords, type ModelNamer, teamOf, withEffort } from './coordinatorNews'
import { git } from './git'
import { Instance } from './Instance'
import { type Note, notesOf, sayNotes } from './notes'
import { Policies, ruleSetOf } from './Policies'
import { withRole } from './roles'
import { sayRules } from './rules'
import { PlanParameters } from './Runs'
import { transcript } from './threads'

/*
 * Handing the coordinator to a fresh session before its context fills
 * (ADR-031). An agent left to fill its context compacts it on its own, at a
 * moment of its choosing, mid-reply even, and what was decided only in
 * conversation may not survive its summary. So Althar watches how full the
 * coordinator's context is, as the agent says, and once it reaches
 * HANDOVER_AT, between turns, starts a fresh session on the same agent,
 * model and effort. The new session is briefed from Althar's records, not
 * the raw thread: the project, its open tasks and where each stands, the
 * project's notes, and the last few messages, so the conversation carries
 * on. The rest of the thread is read through the tools.
 */

/** How full the coordinator's context may get, as a share of its size, before Althar hands it to a fresh session. */
export const HANDOVER_AT = 0.8

/** Whether a coordinator whose context is this full is handed to a fresh session: once its agent has said how full, at the threshold or past it. */
export const dueForHandover = (context: { readonly used: number; readonly size: number } | null) =>
  context !== null && context.size > 0 && context.used >= context.size * HANDOVER_AT

/** About how many characters a token holds, in the words and code a brief is written in: to judge a brief's size before an agent reads it. */
const CHARS_PER_TOKEN = 4

/** The most of a fresh session's context its brief may take: a session that would start fuller would soon be due again. */
export const FRESH_ROOM = 0.4

/**
 * Whether a brief this long leaves a fresh session room in a context the
 * size the session handed over says it has. One that doesn't isn't started:
 * it would be due again at once, and again after it.
 */
export const roomFor = (brief: string, context: { readonly size: number } | null) =>
  context === null || context.size <= 0 || brief.length / CHARS_PER_TOKEN < context.size * FRESH_ROOM

/** How many of the conversation's last messages a handover brief carries word for word, and in how many characters at most. */
export const RECENT_MESSAGES = 12
const RECENT_BUDGET = 16_000

/** How many open tasks, newest first, a brief describes in full; each past them is a line: where it stands, who leads it, and what waits on the person. */
const TASKS_IN_FULL = 25

/** How much of a lead's last report, or of what a stuck step says, a brief carries. */
const REPORT_LENGTH = 600
const DETAIL_LENGTH = 200

const cut = (text: string, length: number) => (text.length > length ? `${text.slice(0, length)}…` : text)

/** The project: its repositories, how many tasks it has, and its rules, as project_overview gives them. */
export const projectOverview = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${projectId}`
    const repositories = yield* sql<{ name: string; role: string; base: string | null; within: string | null; path: string }>`
      SELECT b.display_name AS name, b.role, b.default_base_ref AS base, b.folder AS within, l.path FROM repository_bindings b
      JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
      ORDER BY b.created_at, b.rowid`
    const [counts] = yield* sql<{ open: number; drafts: number }>`
      SELECT sum(state = 'open') AS open, sum(state = 'draft') AS drafts FROM tasks WHERE project_id = ${projectId}`
    return [
      `Project: ${project?.name ?? ''}`,
      `Repositories:\n${repositories
        .map(
          (repository) =>
            `- ${withRole(repository.name, repository.role)} (${repository.base ?? 'main'}), on this Mac at ${repository.path}${repository.within === null ? '' : `; the project is its folder ${repository.within}`}`,
        )
        .join('\n')}`,
      `Tasks: ${counts?.open ?? 0} open, ${counts?.drafts ?? 0} planned and not yet started.`,
      `Rules: ${sayRules(ruleSetOf((yield* (yield* Policies).current(projectId as ProjectId)).rules))}`,
    ].join('\n\n')
  })

/** The project's notes, as a brief holds them. */
export const notesSection = (notes: ReadonlyArray<Note>) =>
  notes.length === 0
    ? 'The project has no notes yet.'
    : `The project's notes: decisions the person made that the code doesn't show. Go by them.\n${sayNotes(notes)}`

/** A call waiting on the person, in words. */
const callWords = (call: { readonly kind: string; readonly payload: string; readonly title: string | null }) => {
  const payload = JSON.parse(call.payload) as Record<string, unknown>
  const words = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : '')
  switch (call.kind) {
    case 'permission':
      return `a permission request${call.title === null ? '' : `: ${call.title}`}`
    case 'question': {
      const fields = Array.isArray(payload.fields) ? (payload.fields as ReadonlyArray<{ readonly question?: string }>) : []
      const asked = fields.flatMap((field) => (field.question === undefined || field.question === '' ? [] : [field.question]))
      return `a question from its lead: ${cut(asked.length > 0 ? asked.join(' / ') : words('message'), DETAIL_LENGTH)}`
    }
    case 'stuck': {
      const detail = words('detail')
      return `its ${words('step') || 'step'} step can't go on without them${detail === '' ? '' : `: ${cut(detail, DETAIL_LENGTH)}`}`
    }
    default:
      return `a call about ${call.kind.replaceAll('_', ' ')}`
  }
}

/**
 * Every open task, newest first, as a brief describes it: where it stands,
 * who does it, and what waits on the person, none left out. Past the newest
 * TASKS_IN_FULL, each is shorter, without its plan or its lead's last report,
 * which read_task gives. Read from the records and the task's worktree;
 * `working` says whether an agent is at work on a thread now.
 */
export const openTasks = (projectId: string, modelOf: ModelNamer, working: (threadId: string) => boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const tasks = yield* sql<{
      id: string
      slug: string
      title: string
      state: string
      threadId: string
      planState: string | null
      parameters: string | null
      startsAt: string | null
      runState: string | null
      step: string | null
      lead: string | null
      leadModel: string | null
    }>`
      SELECT k.id, k.slug, k.title, k.state, t.id AS thread_id,
        p.state AS plan_state, p.parameters, p.starts_at, r.state AS run_state,
        (SELECT n.node_key FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          WHERE e.run_id = r.id AND a.state IN ('admitted', 'running', 'held') ORDER BY a.admitted_at DESC LIMIT 1) AS step,
        (SELECT agent_id FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead,
        (SELECT model FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead_model
      FROM tasks k
      JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1)
      LEFT JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
      WHERE k.project_id = ${projectId} AND k.state IN ('draft', 'open')
      ORDER BY k.created_at DESC, k.rowid DESC`
    const described = yield* Effect.forEach(tasks, (task, index) =>
      Effect.gen(function* () {
        const full = index < TASKS_IN_FULL
        const plan =
          task.parameters === null
            ? undefined
            : Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(PlanParameters))(task.parameters))
        const stands = (() => {
          if (task.state === 'draft')
            return task.planState !== 'proposed'
              ? 'Drafted, with no plan yet.'
              : task.startsAt === null
                ? 'Planned, and held by the person: it waits until they start it.'
                : 'Planned, and counting down: it starts on its own unless the person holds or changes it.'
          if (task.runState === null) return 'Open, with nothing running.'
          if (task.runState === 'succeeded')
            return working(task.threadId) ? 'Under way again, after its steps were done.' : 'Ready: its steps are done.'
          if (task.runState === 'failed' || task.runState === 'cancelled') return 'Stopped.'
          return `Under way${task.step === null ? '' : `, on its ${task.step} step`}.`
        })()
        const planned = plan?.steps.find((step) => step.key === 'implement')
        // The lead it has now, where one started and isn't the one its plan named.
        const lead =
          task.lead !== null &&
          (planned === undefined || planned.agentId !== task.lead || (task.leadModel !== null && planned.model !== task.leadModel))
            ? modelOf({ key: 'implement', agentId: task.lead, model: task.leadModel, skipped: false })
            : null
        const who = full
          ? [
              ...(plan === undefined ? [] : [`Plan: ${teamOf(plan, withEffort(modelOf))}; ${endWords(plan.end)}.`]),
              ...(lead === null ? [] : [`Its lead now: ${lead}.`]),
            ]
          : // In short, only who leads it.
            [lead ?? (planned === undefined ? null : modelOf(planned))].flatMap((name) => (name === null ? [] : [`Led by ${name}.`]))

        // What waits on the person: calls, a pull request with commits they haven't pushed, and a change ready to look over.
        const calls = yield* sql<{ kind: string; payload: string; title: string | null }>`
          SELECT a.kind, a.payload, p.title FROM attention_requests a LEFT JOIN permission_requests p ON p.id = a.permission_request_id
          WHERE a.task_id = ${task.id} AND a.state = 'open' ORDER BY a.created_at`
        // Each in its repository's worktree here, as the record of its push says; the task's first, where it doesn't.
        const changes = yield* sql<{ url: string; snapshot: string; pushed: string | null; worktree: string | null }>`
          SELECT l.url, l.snapshot,
            (SELECT c.head_commit FROM repository_changes c WHERE c.pull_request_url = l.url ORDER BY c.updated_at DESC LIMIT 1) AS pushed,
            coalesce(
              (SELECT w.path FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id
                WHERE c.pull_request_url = l.url ORDER BY c.updated_at DESC LIMIT 1),
              (SELECT w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
                WHERE w.task_id = l.task_id AND w.device_id = ${instance.deviceId} AND w.state = 'ready' ORDER BY b.created_at, b.rowid LIMIT 1)
            ) AS worktree
          FROM external_links l WHERE l.task_id = ${task.id} AND l.kind = 'change' ORDER BY l.created_at`
        const pulls = yield* Effect.forEach(changes, (change) =>
          Effect.gen(function* () {
            const snapshot = JSON.parse(change.snapshot) as { readonly state?: string; readonly draft?: boolean; readonly headSha?: string }
            if (snapshot.state !== 'open') return []
            const pushed = snapshot.headSha ?? change.pushed
            const unpushed =
              pushed === null || pushed === undefined || change.worktree === null
                ? 0
                : yield* git(change.worktree, 'rev-list', '--count', `${pushed}..HEAD`).pipe(
                    Effect.map((count) => Number(count.trim()) || 0),
                    Effect.orElseSucceed(() => 0),
                  )
            return [
              `its pull request ${change.url}${snapshot.draft === true ? ' (a draft)' : ''} is open${unpushed === 0 ? '' : `, with ${unpushed} ${unpushed === 1 ? 'commit' : 'commits'} on the branch they haven't pushed to it`}`,
            ]
          }),
        )
        const ready = task.state === 'open' && task.runState === 'succeeded' && !working(task.threadId) && changes.length === 0
        const waits = [...calls.map(callWords), ...pulls.flat(), ...(ready ? ['the change, to look over and accept'] : [])]

        // What its lead said last, with anything it left open.
        const [report] = !full
          ? []
          : yield* sql<{ content: string }>`
          SELECT content FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result'
            AND json_extract(content, '$.step') IN ('implement', 'settle') ORDER BY sequence DESC LIMIT 1`
        const summary = report === undefined ? '' : ((JSON.parse(report.content) as { summary?: string }).summary ?? '').trim()

        return [
          `- ${task.slug}: ${task.title}. ${[stands, ...who].join(' ')}`,
          ...(waits.length === 0 ? [] : [`  Waiting on the person: ${waits.join('; ')}.`]),
          ...(summary === '' ? [] : [`  Its lead last reported: ${cut(summary, REPORT_LENGTH).replaceAll('\n', ' ')}`]),
        ].join('\n')
      }),
    )
    return {
      count: tasks.length,
      text:
        tasks.length === 0
          ? 'The project has no open tasks.'
          : `Open tasks, newest first${tasks.length > TASKS_IN_FULL ? ` (past the newest ${TASKS_IN_FULL}, each in short: read_task has the rest)` : ''}:\n${described.join('\n')}`,
    }
  })

/**
 * What a fresh coordinator session is told of the conversation it takes
 * over, after its role: that it took over, the project, its notes, its open
 * tasks, and the last few messages, word for word. And how many tasks are
 * open, for the line the person sees.
 */
export const handoverRecord = (input: {
  readonly projectId: string
  readonly threadId: string
  readonly modelOf: ModelNamer
  readonly working: (threadId: string) => boolean
}) =>
  Effect.gen(function* () {
    const overview = yield* projectOverview(input.projectId)
    const notes = yield* notesOf(input.projectId)
    const tasks = yield* openTasks(input.projectId, input.modelOf, input.working)
    const recent = yield* transcript(input.threadId, RECENT_BUDGET, {
      kinds: ['user_message', 'agent_message', 'question'],
      last: RECENT_MESSAGES,
      agent: 'you',
    })
    return {
      open: tasks.count,
      sections: [
        "You are taking over this conversation from an earlier session of yours, whose context was filling up: Althar started you fresh, from its records of the project rather than the whole conversation. What came before the last messages below isn't here. For an earlier detail, read it with read_thread (without a task, it reads this conversation), read_task, or the code, rather than guess. Carry the conversation on from where it stands.",
        `The project, as project_overview gives it:\n\n${overview}`,
        notesSection(notes),
        tasks.text,
        recent.text === ''
          ? 'The conversation has no messages yet.'
          : `The last messages of the conversation, oldest first${recent.omitted > 0 ? ` (the ${recent.omitted} before them are left out)` : ''}:\n${recent.text}`,
      ],
    }
  })
