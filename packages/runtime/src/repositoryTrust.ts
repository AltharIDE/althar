import type { AgentSettingsFile, RepositoryAgentSettings, RepositoryRun, SettingsAgent } from '@althar/contracts'
import { type CommandEnvelope, Ids, newId, type ProjectId } from '@althar/domain'
import {
  type AgentDefinition,
  agents,
  readRepositorySettings,
  type RepositorySettingsFile,
  type SessionOptions,
  untrustedOf,
} from '@althar/provider-adapters'
import { Commands } from '@althar/persistence-sqlite'
import { join } from 'node:path'

import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound } from './errors'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'

/*
 * Trusting a repository's agent settings (DEV-280, docs/decisions/what-agents-may-do.md): what a repository's own
 * Claude Code, Codex and OpenCode settings run, file by file, by the hash of what in each runs, and what the person
 * decided of each. Adding a project is when they're asked; a lead starts without a file whose hash its worktree
 * has and they haven't trusted, and its task says so in one quiet line with Review. Codex loads them all the same
 * (its `untrustedRepositories`), and says so.
 */

/**
 * What the person decided of a repository's settings files: each by its file, the hash decided on, whether trusted,
 * and what it ran as they were shown it.
 */
interface Decision {
  readonly agent: SettingsAgent
  readonly file: string
  readonly hash: string
  readonly trusted: boolean
  readonly runs: ReadonlyArray<RepositoryRun>
}

const AGENTS: ReadonlyArray<string> = ['claude-code', 'codex', 'opencode']

const runsOf = (text: string): ReadonlyArray<RepositoryRun> => {
  try {
    const runs: unknown = JSON.parse(text)
    return Array.isArray(runs) ? (runs as ReadonlyArray<RepositoryRun>) : []
  } catch {
    return []
  }
}

const decisionsOf = (bindingId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ agent: string; file: string; hash: string; trusted: number; runs: string }>`
      SELECT agent, file, hash, trusted, runs FROM repository_trust WHERE binding_id = ${bindingId} ORDER BY file`
    return rows.flatMap((row): ReadonlyArray<Decision> =>
      AGENTS.includes(row.agent)
        ? [{ agent: row.agent as SettingsAgent, file: row.file, hash: row.hash, trusted: row.trusted === 1, runs: runsOf(row.runs) }]
        : [],
    )
  })

/** A hash Althar gives a file it couldn't read: never trusted, so never kept as trusted. */
const unreadHash = (hash: string) => hash.startsWith('unread:')

const definitionOf = (agent: SettingsAgent): AgentDefinition => agents[agent]

/** A file as the person is shown it: its runs, and what they decided of the hash it has now (null for one never decided on). */
const shown = (file: RepositorySettingsFile, decisions: ReadonlyArray<Decision>): AgentSettingsFile => {
  const decided = file.unread === undefined ? decisions.find((one) => one.file === file.file && one.hash === file.hash) : undefined
  return {
    agent: file.agent,
    agentName: definitionOf(file.agent).name,
    file: file.file,
    hash: file.hash,
    runs: file.runs.map(({ file: at, key, when, command }) => ({ file: at, key, when, command })),
    trusted: decided?.trusted ?? null,
    changed: decided === undefined && decisions.some((one) => one.file === file.file && one.trusted),
    loadsAnyway: definitionOf(file.agent).untrustedRepositories !== undefined,
    ...(file.unread === undefined ? {} : { unread: file.unread }),
  }
}

/** A decision on a version of a file its checkout here doesn't have, as the person was shown it then. */
const shownElsewhere = (decision: Decision): AgentSettingsFile => ({
  agent: decision.agent,
  agentName: definitionOf(decision.agent).name,
  file: decision.file,
  hash: decision.hash,
  runs: decision.runs,
  trusted: decision.trusted,
  changed: false,
  loadsAnyway: definitionOf(decision.agent).untrustedRepositories !== undefined,
})

/**
 * A project's repositories' agent settings that run something, as each checkout on this computer has them, from its root
 * down to the project's folder in it, with what the person decided of each; and what they decided of versions the
 * checkout doesn't have, such as a task branch's from its line, so those can be taken back too. Only the repositories
 * with either. Read off the thread.
 */
export const agentSettingsOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [project] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${projectId}`
    if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
    const repositories = yield* sql<{ id: string; name: string; path: string | null; within: string | null }>`
      SELECT b.id, b.display_name AS name, l.path, b.folder AS within FROM repository_bindings b
      LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid`
    const read = yield* Effect.forEach(repositories, (repository) =>
      Effect.gen(function* () {
        const root = repository.path
        const files = root === null ? [] : yield* Effect.promise(() => readRepositorySettings(root, repository.within))
        const decisions = yield* decisionsOf(repository.id)
        const elsewhere = decisions.filter((one) => !files.some((file) => file.file === one.file && file.hash === one.hash))
        if (files.length === 0 && elsewhere.length === 0) return null
        return {
          repositoryId: repository.id,
          name: repository.name,
          files: files.map((file) => shown(file, decisions)),
          ...(elsewhere.length === 0 ? {} : { elsewhere: elsewhere.map(shownElsewhere) }),
        }
      }),
    )
    const found: ReadonlyArray<RepositoryAgentSettings> = read.filter((one) => one !== null)
    return found
  })

/**
 * The person's word on a repository's settings files, by the hash of what each runs as they were shown it: one row a
 * file, the latest word kept. Trusting a file again after a change keeps only the new hash: the old one no longer runs.
 */
export const decideAgentSettings = (input: {
  readonly envelope: CommandEnvelope
  readonly projectId: ProjectId
  readonly repositoryId: string
  readonly trusted: boolean
  readonly files: ReadonlyArray<{
    readonly agent: SettingsAgent
    readonly file: string
    readonly hash: string
    readonly runs: ReadonlyArray<RepositoryRun>
  }>
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const commands = yield* Commands
    const [binding] = yield* sql<{ id: string }>`
      SELECT id FROM repository_bindings WHERE id = ${input.repositoryId} AND project_id = ${input.projectId}`
    if (binding === undefined) return yield* new NotFound({ kind: 'repository', id: input.repositoryId })
    yield* commands.execute({
      envelope: input.envelope,
      projectId: input.projectId,
      result: Schema.Void,
      handle: Effect.forEach(
        input.files,
        (file) =>
          Effect.gen(function* () {
            // One that couldn't be read is never trusted: what it runs wasn't seen.
            if (unreadHash(file.hash)) return
            const decidedAt = yield* timestamp
            const said = {
              agent: file.agent,
              hash: file.hash,
              trusted: input.trusted ? 1 : 0,
              runs: JSON.stringify(file.runs),
              decidedByActorId: input.envelope.actorId,
              decidedAt,
            }
            const [kept] = yield* sql<{ id: string }>`
              SELECT id FROM repository_trust WHERE binding_id = ${input.repositoryId} AND file = ${file.file}`
            let id = kept?.id
            let revision = 1
            if (id === undefined) {
              id = yield* newId(Ids.repositoryTrust)
              yield* sql`INSERT INTO repository_trust ${sql.insert({
                id,
                projectId: input.projectId,
                bindingId: input.repositoryId,
                file: file.file,
                ...said,
              })}`
            } else revision = yield* change('repository_trust', id, said)
            yield* fact({
              projectId: input.projectId,
              aggregateType: 'repository_trust',
              aggregateId: id,
              revision,
              type: input.trusted ? 'repository_trust.trusted' : 'repository_trust.declined',
              payload: { repositoryId: input.repositoryId, agent: file.agent, file: file.file, hash: file.hash },
              actorId: input.envelope.actorId,
              commandId: input.envelope.commandId,
            })
          }),
        { discard: true },
      ),
    })
  })

/**
 * A repository a lead's session starts in: its binding, its folder, the task's worktree of it, and the folder in it the
 * session starts in, where a project is of a folder in it ('' for its root).
 */
export interface StartingIn {
  readonly bindingId: string
  readonly name: string
  readonly root: string
  readonly within: string
}

/** The folders, from the repository's root down to where its session starts, whose instructions a lead still reads. */
export const foldersOf = (starting: StartingIn): ReadonlyArray<string> => {
  const parts = starting.within.split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  return [starting.root, ...parts.map((_, index) => join(starting.root, ...parts.slice(0, index + 1)))]
}

/** The line's offer: the files a lead started without, or loads untrusted, as its folder has them. */
export interface SettingsOffer {
  readonly kind: 'agent_settings'
  readonly projectId: string
  readonly repositoryId: string
  readonly repository: string
  readonly files: ReadonlyArray<AgentSettingsFile>
}

/** How a lead's session starts with its repository's agent settings, and the line its task gets, if any. */
export interface SettingsHold {
  readonly options: Pick<SessionOptions, 'withoutRepositorySettings'>
  readonly offer: SettingsOffer | undefined
  /** Why it can't start at all: where it runs, its agent can't start without what isn't trusted. */
  readonly refused?: string
}

/**
 * How a lead's session starts without its repository's agent settings, where its agent can: on the home through its
 * environment or its session's settings, on a worker only through its session's settings, since a worker starts it
 * with none of Althar's environment. An agent that can do neither there doesn't start.
 */
export const withoutSettings = (
  definition: AgentDefinition,
  starting: StartingIn,
  onWorker: boolean,
): Pick<SettingsHold, 'options' | 'refused'> =>
  definition.untrustedRepositories !== undefined
    ? { options: {} }
    : onWorker && definition.withoutRepositoryOnWorker !== true
      ? {
          options: {},
          refused: `${definition.name} can’t start on a worker without ${starting.name}’s agent settings, which aren’t trusted. Trust them in the project’s settings, under Rules, or run it on this computer.`,
        }
      : { options: { withoutRepositorySettings: { folders: foldersOf(starting) } } }

/**
 * How a lead's session starts with its repository's agent settings: without them, where its agent can start without
 * them and a file of its agent's that its worktree has, from its root to where it starts, isn't trusted or couldn't
 * be read; and the line its task gets, where one of them isn't something the person already said no to (one never
 * seen, or changed since). Codex, which loads them all the same, gets the line too, so the person knows. On a worker,
 * its checkout is the worktree here as it was sent, so this reads that.
 */
export const settingsHoldFor = (definition: AgentDefinition, projectId: string, starting: StartingIn, onWorker = false) =>
  Effect.gen(function* () {
    const agent = definition.id as SettingsAgent
    const none: SettingsHold = { options: {}, offer: undefined }
    if (!AGENTS.includes(agent)) return none
    const files = (yield* Effect.promise(() => readRepositorySettings(starting.root, starting.within))).filter(
      (file) => file.agent === agent,
    )
    const decisions = yield* decisionsOf(starting.bindingId)
    const untrusted = untrustedOf(
      files,
      decisions.filter((one) => one.trusted),
    )
    if (untrusted.length === 0) return none
    const without = withoutSettings(definition, starting, onWorker)
    // What the person already said no to, as it stands, is no news: the lead starts without it quietly.
    const news = untrusted.filter(
      (file) => file.unread !== undefined || !decisions.some((one) => !one.trusted && one.file === file.file && one.hash === file.hash),
    )
    const hold: SettingsHold = {
      ...without,
      offer:
        news.length === 0 || without.refused !== undefined
          ? undefined
          : {
              kind: 'agent_settings',
              projectId,
              repositoryId: starting.bindingId,
              repository: starting.name,
              files: news.map((file) => shown(file, decisions)),
            },
    }
    return hold
  })

/** The line a task's thread gets for `offer`: what its lead started without, or, for Codex, what it loads all the same. */
export const settingsLine = (agentName: string, offer: { readonly repository: string; readonly files: ReadonlyArray<AgentSettingsFile> }) =>
  offer.files.some((file) => file.loadsAnyway)
    ? `${agentName} runs ${offer.repository}’s agent settings, which aren’t trusted: it can’t start without them.`
    : `${agentName} started without ${offer.repository}’s agent settings, which aren’t trusted.`
