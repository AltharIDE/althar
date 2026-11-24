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

/** What the person decided of a repository's settings files: each by its file, the hash decided on, and whether trusted. */
interface Decision {
  readonly file: string
  readonly hash: string
  readonly trusted: boolean
}

const decisionsOf = (bindingId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ file: string; hash: string; trusted: number }>`
      SELECT file, hash, trusted FROM repository_trust WHERE binding_id = ${bindingId}`
    return rows.map((row): Decision => ({ file: row.file, hash: row.hash, trusted: row.trusted === 1 }))
  })

const definitionOf = (agent: SettingsAgent): AgentDefinition => agents[agent]

/** A file as the person is shown it: its runs, and what they decided of the hash it has now (null for one never decided on). */
const shown = (file: RepositorySettingsFile, decisions: ReadonlyArray<Decision>): AgentSettingsFile => {
  const decided = decisions.find((one) => one.file === file.file && one.hash === file.hash)
  return {
    agent: file.agent,
    agentName: definitionOf(file.agent).name,
    file: file.file,
    hash: file.hash,
    runs: file.runs.map(({ file: at, key, when, command }) => ({ file: at, key, when, command })),
    trusted: decided?.trusted ?? null,
    loadsAnyway: definitionOf(file.agent).untrustedRepositories !== undefined,
  }
}

/**
 * A project's repositories' agent settings that run something, as each checkout on this computer has them, with what
 * the person decided of each; only the repositories that have any. Read off the thread.
 */
export const agentSettingsOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [project] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${projectId}`
    if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
    const repositories = yield* sql<{ id: string; name: string; path: string | null }>`
      SELECT b.id, b.display_name AS name, l.path FROM repository_bindings b
      LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid`
    const read = yield* Effect.forEach(repositories, (repository) =>
      Effect.gen(function* () {
        if (repository.path === null) return null
        const folder = repository.path
        const files = yield* Effect.promise(() => readRepositorySettings(folder))
        if (files.length === 0) return null
        const decisions = yield* decisionsOf(repository.id)
        return { repositoryId: repository.id, name: repository.name, files: files.map((file) => shown(file, decisions)) }
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

/** A repository a lead's session starts in: its binding, and its folder, the task's worktree of it. */
export interface StartingIn {
  readonly bindingId: string
  readonly name: string
  readonly folder: string
}

/**
 * How a lead's session starts with its repository's agent settings: without them, where its agent can start without
 * them and a file of its agent's that its worktree has isn't trusted; and the line its task gets, where one of them
 * isn't something the person already said no to (one never seen, or changed since). Codex, which loads them all the
 * same, gets the line too, so the person knows.
 */
export const settingsHoldFor = (definition: AgentDefinition, projectId: string, starting: StartingIn) =>
  Effect.gen(function* () {
    const agent = definition.id as SettingsAgent
    if (!(['claude-code', 'codex', 'opencode'] as ReadonlyArray<string>).includes(agent)) return { options: {}, offer: undefined }
    const files = (yield* Effect.promise(() => readRepositorySettings(starting.folder))).filter((file) => file.agent === agent)
    const decisions = yield* decisionsOf(starting.bindingId)
    const untrusted = untrustedOf(
      files,
      decisions.filter((one) => one.trusted),
    )
    if (untrusted.length === 0) return { options: {}, offer: undefined }
    const options: Pick<SessionOptions, 'withoutRepositorySettings'> =
      definition.untrustedRepositories === undefined ? { withoutRepositorySettings: { folder: starting.folder } } : {}
    // What the person already said no to, as it stands, is no news: the lead starts without it quietly.
    const news = untrusted.filter((file) => !decisions.some((one) => !one.trusted && one.file === file.file && one.hash === file.hash))
    return {
      options,
      offer:
        news.length === 0
          ? undefined
          : {
              kind: 'agent_settings' as const,
              projectId,
              repositoryId: starting.bindingId,
              repository: starting.name,
              files: news.map((file) => shown(file, decisions)),
            },
    }
  })

/** The line a task's thread gets for `offer`: what its lead started without, or, for Codex, what it loads all the same. */
export const settingsLine = (agentName: string, offer: { readonly repository: string; readonly files: ReadonlyArray<AgentSettingsFile> }) =>
  offer.files.some((file) => file.loadsAnyway)
    ? `${agentName} runs ${offer.repository}'s agent settings, which aren't trusted: it can't start without them.`
    : `${agentName} started without ${offer.repository}'s agent settings, which aren't trusted.`
