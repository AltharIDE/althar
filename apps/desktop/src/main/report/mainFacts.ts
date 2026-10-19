import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { databaseIn } from '@althar/runtime/locations'

import { type AgentFacts, adapterOf, repositoryNames, type RuntimeFacts } from './facts'

/*
 * What a report can know without the runtime (DEV-61): when it hasn't
 * started, has stopped, or can't open the store, as after an update that
 * couldn't move it. The main process reads the store itself, read-only,
 * for the migrations it has and the names to hide, and asks each agent's
 * CLI its version; whether an agent is signed in is the runtime's to say, so
 * it is unknown here. It never writes to the store.
 */

/** How long an agent's CLI has to say its version. */
const WAIT_VERSION = 8_000

/** Rows from the store, or none where the table isn't there yet or the store can't be read. */
const rows = (db: DatabaseSync, query: string): ReadonlyArray<Readonly<Record<string, unknown>>> => {
  try {
    return db.prepare(query).all()
  } catch {
    return []
  }
}

/** Each row's columns that are text, by name: what the store holds is checked, as anything read from disk is. */
const texts = <const K extends string>(list: ReadonlyArray<Readonly<Record<string, unknown>>>, ...keys: ReadonlyArray<K>) =>
  list.flatMap((row) => {
    const picked: Partial<Record<K, string>> = {}
    for (const key of keys) {
      const value = row[key]
      if (typeof value !== 'string') return []
      picked[key] = value
    }
    // Every key was set above, or the row was left out.
    return [picked as Record<K, string>]
  })

/** The store's migrations and names, read-only; nothing where there is no store. */
export const storeFacts = (profile: string): Pick<RuntimeFacts, 'migrations' | 'projects' | 'repositories'> => {
  const file = databaseIn(profile)
  if (!existsSync(file)) return { migrations: [], projects: [], repositories: [] }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(file, { readOnly: true })
  } catch {
    return { migrations: [], projects: [], repositories: [] }
  }
  try {
    return {
      migrations: rows(db, 'SELECT migration_id AS id, name FROM schema_migrations ORDER BY migration_id').flatMap((row) =>
        typeof row.id === 'number' && typeof row.name === 'string' ? [{ id: row.id, name: row.name }] : [],
      ),
      projects: texts(rows(db, 'SELECT name, slug FROM projects'), 'name', 'slug').flatMap((project) => [project.name, project.slug]),
      repositories: repositoryNames({
        bindings: texts(
          rows(db, 'SELECT slug, display_name AS displayName, remote_fingerprints AS remoteFingerprints FROM repository_bindings'),
          'slug',
          'displayName',
          'remoteFingerprints',
        ),
        locations: texts(rows(db, 'SELECT path, observed_remotes AS observedRemotes FROM repository_locations'), 'path', 'observedRemotes'),
        folders: texts(rows(db, 'SELECT path FROM project_folders'), 'path'),
      }),
    }
  } finally {
    db.close()
  }
}

/** Each agent Althar knows, by its CLI's version and its adapter's; whether it is signed in is unknown without the runtime. */
const agentFacts = async (): Promise<ReadonlyArray<AgentFacts>> => {
  // Loaded only when a report needs it, so the main process doesn't carry the agents' code from the start.
  const { agents, agentVersion } = await import('@althar/provider-adapters')
  const { Effect } = await import('effect')
  return Promise.all(
    Object.values(agents).map(async (definition) => ({
      id: definition.id,
      name: definition.name,
      version: await Effect.runPromise(
        agentVersion(definition).pipe(Effect.timeoutOrElse({ duration: WAIT_VERSION, orElse: () => Effect.succeed(null) })),
      ).catch(() => null),
      adapter: adapterOf(definition.id),
      signIn: 'unknown' as const,
    })),
  )
}

/** What the main process can say for a report without the runtime. */
export const mainFacts = async (profile: string): Promise<RuntimeFacts> => ({
  agents: await agentFacts().catch(() => []),
  ...storeFacts(profile),
  thread: null,
  turns: [],
})
