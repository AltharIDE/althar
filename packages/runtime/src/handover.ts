import { errandLines } from './Errands'
import { plainTitle } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { thisDevice } from './device'
import { endWords, type ModelNamer, teamOf, withEffort } from './coordinatorNews'
import { git } from './git'
import { Instance } from './Instance'
import { asideIn } from './kinds'
import { type Note, notesOf, sayNotes } from './notes'
import { Policies, ruleSetOf } from './Policies'
import { withRole } from './roles'
import { sayRules } from './ruleContext'
import { PlanParameters } from './planParameters'
import { instructionsSection, repositoryInstructions } from './repositoryInstructions'
import { type ItemKind, lastWithin, piecesOf, transcriptLines } from './threads'

/** How many of the conversation's last messages a handover brief carries word for word, and in how many characters at most. */
export const RECENT_MESSAGES = 12
export const RECENT_BUDGET = 16_000

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
    // Asides are chats on Scratch, not tasks: none is counted.
    const [counts] = yield* sql<{ open: number; drafts: number }>`
      SELECT sum(k.state = 'open') AS open, sum(k.state = 'draft') AS drafts FROM tasks k
      WHERE k.project_id = ${projectId} AND NOT ${sql.unsafe(asideIn('k'))}`
    return [
      `Project: ${project?.name ?? ''}`,
      `Repositories:\n${repositories
        .map(
          (repository) =>
            `- ${withRole(repository.name, repository.role)} (${repository.base ?? 'main'}), on ${thisDevice()} at ${repository.path}${repository.within === null ? '' : `; the project is its folder ${repository.within}`}`,
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
      return `a permission request${call.title === null ? '' : `: ${plainTitle(call.title)}`}`
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

/** The calls of a task that wait on the person, oldest first. */
const callsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ kind: string; payload: string; title: string | null }>`
      SELECT a.kind, a.payload, p.title FROM attention_requests a LEFT JOIN permission_requests p ON p.id = a.permission_request_id
      WHERE a.task_id = ${taskId} AND a.state = 'open' ORDER BY a.created_at`
  })

/** What a task's lead said last, finishing its work: nothing where it hasn't yet. */
const lastReport = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [report] = yield* sql<{ content: string }>`
      SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
        AND json_extract(content, '$.step') IN ('implement', 'settle') ORDER BY sequence DESC LIMIT 1`
    return report === undefined ? '' : ((JSON.parse(report.content) as { summary?: string }).summary ?? '').trim()
  })

/** The lines under a task in a brief: what waits on the person, and what its lead last reported. */
const underIt = (waits: ReadonlyArray<string>, summary: string) => [
  ...(waits.length === 0 ? [] : [`  Waiting on the person: ${waits.join('; ')}.`]),
  ...(summary === '' ? [] : [`  Its lead last reported: ${cut(summary, REPORT_LENGTH).replaceAll('\n', ' ')}`]),
]

/**
 * Every open task, newest first, as a brief describes it: where it stands,
 * who does it, and what waits on the person, none left out. Asides, chats on
 * Scratch, stay out of its task brief. Past the newest TASKS_IN_FULL, each
 * is shorter, without its plan or its lead's last report,
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
      WHERE k.project_id = ${projectId} AND k.state IN ('draft', 'open') AND NOT ${sql.unsafe(asideIn('k'))}
      ORDER BY k.created_at DESC, k.rowid DESC`
    const described = yield* Effect.forEach(
      tasks,
      (task, index) =>
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
          const calls = yield* callsOf(task.id)
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
              const snapshot = JSON.parse(change.snapshot) as {
                readonly state?: string
                readonly draft?: boolean
                readonly headSha?: string
              }
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
          const summary = full ? yield* lastReport(task.threadId) : ''
          return [`- ${task.slug}: ${task.title}. ${[stands, ...who].join(' ')}`, ...underIt(waits, summary)].join('\n')
        }),
      // A few at once: each may ask git how far its branch is ahead, and the brief is in the way of the person's words.
      { concurrency: 4 },
    )
    return {
      count: tasks.length,
      text:
        tasks.length === 0
          ? 'The project has no open tasks.'
          : `Open tasks, newest first${tasks.length > TASKS_IN_FULL ? ` (past the newest ${TASKS_IN_FULL}, each in short: read_task has the rest)` : ''}:\n${described.join('\n')}`,
    }
  })

/** How many of the project's tasks finished last a brief names, and how much of each one's last report it carries. */
export const FINISHED_SHOWN = 10
const FINISHED_REPORT = 240

/**
 * The project's tasks finished last, newest first: done, merged or
 * discarded, with its pull request where one merged and what its lead last
 * said. So a session knows what shipped lately, and doesn't propose again
 * what was just done or set aside.
 */
export const recentlyFinished = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const tasks = yield* sql<{ slug: string; title: string; state: string; settledAt: string; threadId: string; merged: string | null }>`
      SELECT k.slug, k.title, k.state, k.settled_at, t.id AS thread_id,
        (SELECT l.url FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change'
          AND json_extract(l.snapshot, '$.state') = 'merged' ORDER BY l.created_at DESC LIMIT 1) AS merged
      FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      WHERE k.project_id = ${projectId} AND k.state IN ('done', 'abandoned') AND k.settled_at IS NOT NULL
        AND NOT ${sql.unsafe(asideIn('k'))}
      ORDER BY k.settled_at DESC, k.rowid DESC LIMIT ${FINISHED_SHOWN}`
    const lines = yield* Effect.forEach(tasks, (task) =>
      Effect.gen(function* () {
        const how = task.state === 'abandoned' ? 'Discarded' : task.merged === null ? 'Done' : `Merged, ${task.merged}`
        const summary = task.state === 'abandoned' ? '' : yield* lastReport(task.threadId)
        return `- ${task.slug}: ${task.title}. ${how}, ${task.settledAt.slice(0, 10)}.${summary === '' ? '' : ` ${cut(summary, FINISHED_REPORT).replaceAll('\n', ' ')}`}`
      }),
    )
    return lines.length === 0
      ? 'No task of the project has finished yet.'
      : `The tasks finished last, newest first (find_tasks and read_task have the rest):\n${lines.join('\n')}`
  })

/** How much of the conversation before the last messages a brief carries in short, and how much of each line. */
export const EARLIER_BUDGET = 20_000
export const EARLIER_PERSON = 500
export const EARLIER_REST = 200

/** What the short account of the earlier conversation says: what was said and asked, and what came of it. Not tool calls. */
const EARLIER_KINDS: ReadonlyArray<ItemKind> = [
  'user_message',
  'agent_message',
  'question',
  'task',
  'issue_draft',
  'issue_changes',
  'review_draft',
  'task_ask',
]

/** What a brief carries of the conversation word for word: its last part, within a budget, at most so many lines, of these kinds. */
export interface Recent {
  readonly budget: number
  readonly last?: number
  readonly kinds?: ReadonlyArray<ItemKind>
}

/**
 * The conversation as a brief carries it: its last part word for word, and
 * before that, in short, everything the person said and the start of each
 * reply, with the tasks, issues and questions that came of it. Althar writes
 * the short part from its records, with no agent, so no handover waits for
 * one: it is each line cut, the person's longer than the rest, the newest
 * kept where all of it doesn't fit.
 */
export const conversation = (threadId: string, recent: Recent) =>
  Effect.gen(function* () {
    // What waits for the fresh session is its first turn's message, said there.
    const lines = yield* transcriptLines(threadId, { agent: 'you', waiting: false })
    const pieces = lines.flatMap((line, at) => piecesOf(line.text, recent.budget).map((text) => ({ kind: line.kind, text, at })))
    const shown = pieces.filter((piece) => recent.kinds === undefined || recent.kinds.includes(piece.kind))
    const { kept, omitted } = lastWithin(shown, recent.budget, recent.last)
    // In short, whole lines from before the first kept: a line kept in part is there word for word.
    const before = lines.slice(0, kept[0]?.at ?? lines.length)
    const short = before
      .filter((line) => EARLIER_KINDS.includes(line.kind))
      .map((line) => ({ text: cut(line.text, line.kind === 'user_message' ? EARLIER_PERSON : EARLIER_REST).replaceAll('\n', ' ') }))
    const earlier = lastWithin(short, EARLIER_BUDGET)
    return [
      ...(earlier.kept.length === 0
        ? []
        : [
            `Earlier in the conversation, in short, oldest first: what the person said, the start of each reply, and what came of it${earlier.omitted > 0 ? ` (the ${earlier.omitted} lines before these are left out)` : ''}. read_thread has each of them whole:\n${earlier.kept.map((line) => line.text).join('\n')}`,
          ]),
      kept.length === 0
        ? 'The conversation has no messages yet.'
        : `The last messages of the conversation, oldest first${omitted > 0 ? ` (the ${omitted} before them are ${earlier.kept.length === 0 ? 'left out' : 'in short above'})` : ''}:\n${kept.map((line) => line.text).join('\n')}`,
    ]
  })

/** The repositories a brief reads the instructions of: the coordinator's copies. */
type Copies = ReadonlyArray<{ readonly name: string; readonly root: string; readonly within: string | null }>

/**
 * What a coordinator session is told after its role, from Althar's
 * records rather than the agent's memory: the project, its notes, what its
 * repositories tell agents, its open tasks and those finished last, its
 * errands, and the conversation. Every session gets it, a fresh one on
 * opening the project as much as one recovering a lost session. After
 * compaction the agent already has the conversation, so it gets the project
 * record on its own.
 *
 * Each part reads on its own, so they are read at once: a brief is in the
 * way of the person's first words to the session.
 */
export const coordinatorRecord = (input: {
  readonly projectId: string
  readonly threadId: string
  readonly modelOf: ModelNamer
  readonly working: (threadId: string) => boolean
  readonly copies?: Copies
  readonly recent?: Recent
}) =>
  Effect.gen(function* () {
    // A part Althar can't read says so, and the session starts without it: its tools read the same again.
    const orSaid = <A, E, R>(part: Effect.Effect<A, E, R>, what: string, instead: A) =>
      part.pipe(Effect.catch((error) => Effect.as(Effect.logWarning(`Could not read ${what} for the coordinator's brief`, error), instead)))
    const [overview, notes, instructions, tasks, finished, errands, said] = yield* Effect.all(
      [
        orSaid(projectOverview(input.projectId), 'the project', "Althar couldn't read the project just now: project_overview reads it."),
        notesOf(input.projectId),
        repositoryInstructions(input.copies ?? []),
        orSaid(openTasks(input.projectId, input.modelOf, input.working), 'the open tasks', {
          count: 0,
          text: "Althar couldn't read the open tasks just now: list_tasks reads them.",
        }),
        orSaid(recentlyFinished(input.projectId), 'the tasks finished last', "Althar couldn't read the tasks finished last just now."),
        errandLines(input.projectId),
        input.recent === undefined ? Effect.succeed([]) : conversation(input.threadId, input.recent),
      ],
      { concurrency: 'unbounded' },
    )
    return {
      open: tasks.count,
      sections: [
        `The project, as project_overview gives it:\n\n${overview}`,
        notesSection(notes),
        ...instructionsSection(instructions),
        tasks.text,
        finished,
        `Open errands (only their recorded next steps may act in a news turn):\n${errands.join('\n') || 'None.'}`,
        ...said,
      ],
    }
  })

/** What a session recovering a lost session carries of the conversation word for word: its last few messages. */
export const HANDED_OVER: Recent = { budget: RECENT_BUDGET, last: RECENT_MESSAGES, kinds: ['user_message', 'agent_message', 'question'] }

/** The line a session recovering a lost session is told first, after its role. */
export const TOOK_OVER =
  "You are taking over this conversation from an earlier session of yours, which was lost: Althar started you fresh, from its records of the project rather than the whole conversation. Earlier messages are below in short; for anything they don't say, read it with read_thread (without a task, it reads this conversation), read_task, or the code, rather than guess. Carry the conversation on from where it stands."

/**
 * What a fresh coordinator session is told of the conversation it takes
 * over, after its role: that it took over, then the record, with the last
 * few messages word for word.
 */
export const handoverRecord = (input: {
  readonly projectId: string
  readonly threadId: string
  readonly modelOf: ModelNamer
  readonly working: (threadId: string) => boolean
  readonly copies?: Copies
}) =>
  Effect.map(coordinatorRecord({ ...input, recent: HANDED_OVER }), (record) => ({
    open: record.open,
    sections: [TOOK_OVER, ...record.sections],
  }))
