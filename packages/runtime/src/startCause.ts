import type { CommandEnvelope, ProjectId } from '@althar/domain'
import { codexHome, codexLogSaid, type LocalCause, localCauseOf, stillThere, strayIn } from '@althar/provider-adapters'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { NotFound } from './errors'
import { homeShortened, redacted } from './gitSaid'
import { change, fact, timestamp } from './records'
import type { StuckInfo } from './runRecords'
import { addItem } from './threads'
import { sentence } from './words'

/*
 * Why an agent couldn't start or carry on, where the reason is on this
 * computer (DEV-285): a file where it reads a folder, a folder it may not
 * open, a read-only disk, settings that don't parse. Read from what it said,
 * and for Codex from its own log too, where its stream says only "internal
 * error"; where it names no path, the checkout is looked at for the file in
 * the way. Such a step stops at once with the reason, rather than backing off
 * as for a provider that failed, and its card offers the coordinator's fix.
 */

/** A local cause found, in the window's words, and how it is known again on another task of the project. */
export interface LocalFound {
  readonly kind: LocalCause['kind']
  /** The path in the way, shortened to `~`, where there is one. */
  readonly path?: string
  /** What the agent said, its own words. */
  readonly said: string
  /** After "<agent> can't start: ", in a sentence. */
  readonly words: string
  /** The same cause on another task: its kind and its path, or its words where it names none. */
  readonly key: string
}

/** A local cause in the window's words, after "<agent> can't start: ". */
export const localWords = (cause: { readonly kind: LocalCause['kind']; readonly path?: string; readonly said: string }): string => {
  const path = cause.path === undefined ? undefined : `\`${cause.path}\``
  const said = redacted(homeShortened(cause.said))
  switch (cause.kind) {
    case 'not_a_folder':
      return path === undefined ? sentence(`a file stands where it reads a folder (${said})`) : `${path} is a file, not a folder.`
    case 'is_a_folder':
      return path === undefined ? sentence(`a folder stands where it reads a file (${said})`) : `${path} is a folder, not a file.`
    case 'no_permission':
      return path === undefined ? sentence(`it may not open a file it needs (${said})`) : `it may not open ${path}.`
    case 'read_only':
      return path === undefined ? sentence(`a file it writes is on a read-only disk (${said})`) : `${path} is on a read-only disk.`
    case 'config':
      return path === undefined ? sentence(`its settings can't be read: ${said}`) : sentence(`${path} can't be read: ${said}`)
  }
}

/** What an agent said, read for a local cause, the checkout looked at where it names no path. */
export const localFoundIn = (agentId: string, said: string, folder: string | null): LocalFound | undefined => {
  const cause = localCauseOf(said)
  if (cause === undefined) return undefined
  // A file in the way is the one to name, wherever the agent read: its own folder at the checkout's root, or along its path.
  const stray =
    folder !== null && (cause.kind === 'not_a_folder' || cause.kind === 'config') ? strayIn(agentId, folder, cause.path) : undefined
  const kind = stray === undefined ? cause.kind : 'not_a_folder'
  const full = stray ?? cause.path
  const path = full === undefined ? undefined : homeShortened(full)
  const found = { kind, said: cause.said, ...(path === undefined ? {} : { path }) }
  return { ...found, words: localWords(found), key: `${kind}:${path ?? cause.said}` }
}

/**
 * The local cause of a task's agent's failure, where there is one: from what it said, and for Codex its own log of the
 * session it last had on the task (or what it wrote since that session started, where it had none yet), with the task's
 * folder here to look in. Undefined where none is found, or it can't be looked for.
 */
export const diagnose = (input: { readonly taskId: string; readonly agentId: string; readonly deviceId: string; readonly said: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [where] = yield* sql<{ path: string }>`
      SELECT path FROM workspaces WHERE task_id = ${input.taskId} AND device_id = ${input.deviceId} AND state = 'ready'
      ORDER BY created_at, rowid LIMIT 1`
    const [session] = yield* sql<{ externalSessionId: string | null; startedAt: string }>`
      SELECT s.external_session_id, s.started_at FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
      WHERE t.task_id = ${input.taskId} AND s.agent_id = ${input.agentId}
      ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1`
    return yield* Effect.sync(() => {
      const logged =
        input.agentId === 'codex' && session !== undefined
          ? codexLogSaid(
              codexHome(),
              session.externalSessionId === null ? { since: Date.parse(session.startedAt) - 1000 } : { id: session.externalSessionId },
            )
          : ''
      return localFoundIn(input.agentId, [input.said, logged].filter((one) => one !== '').join('\n'), where?.path ?? null)
    })
  }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not look for an agent’s local cause', cause), undefined)))

/**
 * The person asked the coordinator to fix what stops a task's agent on this computer (DEV-285), from its card: the call
 * says when, so its card shows it, the task's thread says so, and the coordinator's news is written, with the cause, the
 * checkout, the tasks that wait on the same, and how to go on. Undefined where the call isn't open, isn't one, or the
 * project has no coordinator thread.
 */
export const askToFix = (attentionId: string, envelope: CommandEnvelope) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* sql<{ projectId: ProjectId; taskId: string; payload: string; state: string }>`
      SELECT project_id, task_id, payload, state FROM attention_requests WHERE id = ${attentionId} AND kind = 'stuck'`
    if (call === undefined) return yield* new NotFound({ kind: 'attention_request', id: attentionId })
    const info = JSON.parse(call.payload) as StuckInfo
    if (call.state !== 'open' || info.why !== 'local_cause') return undefined
    const [task] = yield* sql<{ slug: string; title: string; threadId: string | null }>`
      SELECT k.slug, k.title, (SELECT id FROM threads WHERE task_id = k.id AND kind = 'task' LIMIT 1) AS thread_id
      FROM tasks k WHERE k.id = ${call.taskId}`
    const [home] = yield* sql<{ id: string }>`
      SELECT id FROM threads WHERE project_id = ${call.projectId} AND kind = 'coordinator' ORDER BY created_at LIMIT 1`
    if (task === undefined || home === undefined) return undefined
    const [where] = yield* sql<{ path: string }>`
      SELECT path FROM workspaces WHERE task_id = ${call.taskId} AND state = 'ready' ORDER BY created_at, rowid LIMIT 1`
    const waiting = yield* sql<{ slug: string }>`
      SELECT DISTINCT k.slug FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
      JOIN runs r ON r.id = e.run_id JOIN tasks k ON k.id = r.task_id
      WHERE r.project_id = ${call.projectId} AND r.state = 'running' AND a.state = 'held' AND a.hold_reason = 'agent_unavailable'
        AND json_extract(a.output, '$.local.key') = ${info.cause?.key ?? ''}`
    const at = yield* timestamp
    const payload: StuckInfo = { ...info, cause: { key: info.cause?.key ?? '', ...info.cause, askedAt: at } }
    const revision = yield* change('attention_requests', attentionId, { payload: JSON.stringify(payload) })
    yield* fact({
      projectId: call.projectId,
      aggregateType: 'attention_request',
      aggregateId: attentionId,
      revision,
      type: 'attention_request.fix_asked',
      payload: { cause: info.cause?.key },
      actorId: envelope.actorId,
      commandId: envelope.commandId,
    })
    if (task.threadId !== null)
      yield* addItem({ projectId: call.projectId, threadId: task.threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title: 'Asked the coordinator to fix it.',
      })
    yield* touchCard(call.taskId)
    const agent = info.agentId ?? 'its agent'
    const body = [
      `Althar's news (the person pressed “Let the coordinator fix it” on ${task.slug}'s card; not their own words): ${agent} can't start on ${task.slug}: ${info.detail ?? ''}`,
      ...(where === undefined ? [] : [`Its checkout: ${homeShortened(where.path)}.`]),
      ...(waiting.length === 0 ? [] : [`Waiting on the same cause: ${waiting.map((one) => one.slug).join(', ')}.`]),
      'Althar stopped it without retrying: this is on this computer, not the provider. Diagnose it from the error and the checkout.',
      'Where it is in the person’s checkout or on this computer and not in the repository’s tracked files (a stray or git-ignored file, a lock, a permission), fix it there: that is outside your folder, so ask the person first, as for anything outside it.',
      'Where it is in the repository’s tracked files, plan a small fix task (propose_plan, Small change) whose merge to main reaches the other tasks as they merge main.',
      `Once the cause is gone, try ${task.slug}'s step again (answer_stuck_step, again); the tasks waiting on the same cause go on by themselves. Tell the person in a line what you found and what you did.`,
    ].join('\n')
    return { threadId: home.id, body }
  })

/** The kind a cause's key starts with. */
const kindOfKey = (key: string): LocalCause['kind'] | undefined => {
  const kind = key.split(':')[0]
  return kind === 'not_a_folder' || kind === 'is_a_folder' || kind === 'no_permission' || kind === 'read_only' || kind === 'config'
    ? kind
    : undefined
}

/** Whether the checkout can show a cause gone: a file where a folder is read, or the other way round, at a path. */
export const causeKnown = (key: string): boolean => {
  const kind = kindOfKey(key)
  return kind === 'not_a_folder' || kind === 'is_a_folder'
}

/** Whether a cause the checkout can show is gone: the path in the way is a folder now, or not there. */
export const causeGone = (key: string, path: string | undefined): boolean => {
  const kind = kindOfKey(key)
  return kind !== undefined && path !== undefined && stillThere({ kind, path, said: '' }) === false
}
