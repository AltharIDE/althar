import { agentVersion } from '@althar/provider-adapters'
import { Agents, Installs, SignIns } from '@althar/runtime'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { type AgentFacts, adapterOf, repositoryNames, type RuntimeFacts } from '../main/report/facts'

/*
 * What the runtime knows that a report needs (DEV-61), for the main process,
 * which asks: each agent's version, its adapter's and whether it is signed
 * in; the profile's migrations; the thread the report is about, by its task
 * and project; the latest turns that ended with an error, by their ids; and
 * the names of the person's projects and repositories, only so the main
 * process can hide them. Never what anyone wrote, and never who an agent is
 * signed in as.
 */

/**
 * The names of the person's projects and repositories, alone, for the main
 * process to hide in a crash report (main/crashReports.ts): the store is the
 * runtime's alone while it runs, so main can't read them itself.
 */
export const runtimeNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projects = yield* sql<{ name: string; slug: string }>`SELECT name, slug FROM projects`
  const bindings = yield* sql<{ slug: string; displayName: string; remoteFingerprints: string }>`
    SELECT slug, display_name, remote_fingerprints FROM repository_bindings`
  const locations = yield* sql<{ path: string; observedRemotes: string }>`SELECT path, observed_remotes FROM repository_locations`
  const folders = yield* sql<{ path: string }>`SELECT path FROM project_folders`
  return {
    projects: projects.flatMap((project) => [project.name, project.slug]),
    repositories: repositoryNames({ bindings, locations, folders }),
  } satisfies Pick<RuntimeFacts, 'projects' | 'repositories'>
})

/* Each CLI's version, asked once a launch: it starts the CLI. */
const versions = new Map<string, string | null>()

export const runtimeFacts = (threadId: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const agents = yield* Agents
    const installs = yield* Installs
    const signIns = yield* SignIns

    const agentFacts = yield* Effect.forEach(
      agents.list,
      ({ definition }) =>
        Effect.gen(function* () {
          const install = yield* installs.state(definition)
          const installed = definition.cli === undefined || install.located !== null
          if (!versions.has(definition.id) && installed) versions.set(definition.id, yield* agentVersion(definition))
          return {
            id: definition.id,
            name: definition.name,
            version: versions.get(definition.id) ?? null,
            adapter: adapterOf(definition.id),
            signIn: installed ? yield* signIns.of(definition.id) : 'not_installed',
          } satisfies AgentFacts
        }),
      { concurrency: 'unbounded' },
    )

    const migrations = yield* sql<{
      id: number
      name: string
    }>`SELECT migration_id AS id, name FROM schema_migrations ORDER BY migration_id`
    const names = yield* runtimeNames

    const [thread] =
      threadId === null
        ? []
        : yield* sql<{ taskId: string | null; projectId: string }>`SELECT task_id, project_id FROM threads WHERE id = ${threadId}`
    const taskId = thread?.taskId ?? null
    const turns = yield* sql<{
      id: string
      threadId: string
      taskId: string | null
      agent: string
      state: string
      errorClass: string | null
      endedAt: string | null
    }>`SELECT td.id, td.thread_id, t.task_id, ps.agent_id AS agent, td.state, td.error_class, td.ended_at
      FROM turn_deliveries td
      JOIN provider_sessions ps ON ps.id = td.provider_session_id
      JOIN threads t ON t.id = td.thread_id
      WHERE td.id IN (
        SELECT id FROM turn_deliveries WHERE state = 'failed' ORDER BY requested_at DESC LIMIT 10
      ) OR (${taskId} IS NOT NULL AND t.task_id = ${taskId} AND td.id IN (
        SELECT d.id FROM turn_deliveries d JOIN threads h ON h.id = d.thread_id WHERE h.task_id = ${taskId} ORDER BY d.requested_at DESC LIMIT 15
      ))
      ORDER BY td.requested_at DESC`

    return {
      agents: agentFacts,
      migrations,
      ...names,
      thread: thread === undefined ? null : { taskId: thread.taskId, projectId: thread.projectId },
      turns,
    } satisfies RuntimeFacts
  })
