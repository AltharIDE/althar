import { copyFile, mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { OtherTool } from '@althar/domain'
import { cleanUp } from '@althar/provider-adapters'
import { Effect } from 'effect'

import type { Places, Roots } from './places'

/*
 * What Orca, T3 Code and Paradev say of the worktrees they made: each one's
 * name, its pull request and whether it was archived, read from their own
 * stores as their code writes them (docs/decisions/workspaces-and-runs.md,
 * "Bringing in other tools' work"). Conductor's store isn't documented, so
 * its worktrees are known by their folders alone; Cursor keeps nothing of
 * its own.
 *
 * Read only, to the byte: a database is copied, with its write-ahead log,
 * into a folder of Althar's own and read there, so not even SQLite's
 * shared-memory index of the tool's own file is touched, and what the tool
 * hasn't checkpointed yet is still read. A store that can't be read is left
 * out, as if the tool had nothing: the others are read all the same.
 */

/** What a tool's records say of one of its worktrees. */
export interface Recorded {
  readonly tool: OtherTool
  readonly path: string
  readonly name: string | null
  /** What the person asked for in it, where the tool keeps that. */
  readonly asked: string | null
  readonly pullRequest: { readonly number: number; readonly url: string } | null
  readonly archived: boolean
  readonly createdAt: string | null
}

export interface Stores {
  readonly worktrees: ReadonlyArray<Recorded>
  readonly roots: Roots
}

/** A database larger than this isn't copied: it is a tool's whole history, not a list of worktrees. */
const LARGEST = 512 * 1024 * 1024

/** Reads a copy of the SQLite database at `path`, with its log, in a folder of its own that goes once read; null where there is none. */
export const readCopy = async <A>(path: string, read: (db: DatabaseSync) => A): Promise<A | null> => {
  const size = await stat(path).then(
    (found) => (found.isFile() ? found.size : null),
    () => null,
  )
  if (size === null || size > LARGEST) return null
  const folder = await mkdtemp(join(tmpdir(), 'althar-elsewhere-'))
  try {
    const copy = join(folder, basename(path))
    await copyFile(path, copy)
    // What is still in the log is the tool's latest: copied too, SQLite reads it into the copy as it opens.
    await copyFile(`${path}-wal`, `${copy}-wal`).catch(() => undefined)
    const db = new DatabaseSync(copy, { readOnly: false })
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    // Best effort: a copy left behind is logged, never the read's failure.
    await Effect.runPromise(cleanUp(folder, 'a copy of another tool’s store, read'))
  }
}

/** The columns a table has, so a reader takes only those an older version of the tool had already. */
export const columnsOf = (db: DatabaseSync, table: string): ReadonlySet<string> => {
  const rows = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table)
  return new Set(rows.flatMap((row) => (typeof row['name'] === 'string' ? [row['name']] : [])))
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const parse = (value: unknown): unknown => {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}
/** A time a tool wrote as an ISO string or epoch milliseconds or seconds, as ISO. */
export const isoOf = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value < 1e11 ? value * 1000 : value).toISOString()
  if (typeof value === 'string' && value !== '') {
    const at = Date.parse(value)
    return Number.isNaN(at) ? null : new Date(at).toISOString()
  }
  return null
}
const pullRequestOf = (value: unknown): Recorded['pullRequest'] => {
  const found = record(value)
  if (found === null) return null
  const url = text(found['url'])
  const number = typeof found['number'] === 'number' ? found['number'] : Number(url?.match(/\/(\d+)\/?$/)?.[1] ?? Number.NaN)
  return url === null || !Number.isInteger(number) ? null : { number, url }
}
const readJson = (path: string) => readFile(path, 'utf8').then(parse, () => null)

/**
 * Orca: its profiles (`orca-profile-index.json`), each with a
 * `profile-state.db` whose documents are the old `orca-data.json`'s top-level
 * keys, the big ones split into a row an entry (`profile_state_document_parts`,
 * authoritative only while its meta's `legacy_revision` is the document's
 * revision). `worktreeMeta` is keyed `<repoId>::<worktree path>`.
 */
const orcaDomains = (db: DatabaseSync, domains: ReadonlyArray<string>) => {
  const found = new Map<string, unknown>()
  const tables = new Set(
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((row) => row['name']),
  )
  for (const domain of domains) {
    const document = db.prepare('SELECT payload, revision FROM profile_state_documents WHERE domain = ?').get(domain)
    const split =
      tables.has('profile_state_document_parts_meta') && document !== undefined
        ? db.prepare('SELECT legacy_revision FROM profile_state_document_parts_meta WHERE domain = ?').get(domain)
        : undefined
    if (split !== undefined && split['legacy_revision'] === document?.['revision']) {
      const parts = db.prepare('SELECT part_key, payload FROM profile_state_document_parts WHERE domain = ? ORDER BY ordinal').all(domain)
      const value: Record<string, unknown> = {}
      for (const part of parts) {
        const key = parse(part['part_key'])
        if (Array.isArray(key) && key.length === 1 && typeof key[0] === 'string') value[key[0]] = parse(part['payload'])
      }
      found.set(domain, value)
    } else if (document !== undefined) found.set(domain, parse(document['payload']))
  }
  return found
}

const orca = async (places: Places): Promise<Stores> => {
  const worktrees: Array<Recorded> = []
  const roots: Array<string> = []
  for (const data of places.orca) {
    const index = record(await readJson(join(data, 'orca-profile-index.json')))
    const listed = Array.isArray(index?.['profiles']) ? index['profiles'] : []
    const ids = new Set(['local-default', ...listed.flatMap((one) => text(record(one)?.['id']) ?? [])])
    for (const id of ids) {
      const folder = join(data, 'profiles', id)
      const fromDb = await readCopy(join(folder, 'profile-state.db'), (db) => orcaDomains(db, ['repos', 'settings', 'worktreeMeta'])).catch(
        () => null,
      )
      const json = fromDb === null || fromDb.size === 0 ? record(await readJson(join(folder, 'orca-data.json'))) : null
      const domain = (name: string) => (fromDb !== null && fromDb.size > 0 ? fromDb.get(name) : json?.[name])
      const settings = record(domain('settings'))
      const workspaceDir = text(settings?.['workspaceDir'])
      if (workspaceDir !== null) roots.push(workspaceDir)
      const repos = Array.isArray(domain('repos')) ? (domain('repos') as ReadonlyArray<unknown>) : []
      for (const repo of repos) {
        const base = text(record(repo)?.['worktreeBasePath'])
        const path = text(record(repo)?.['path'])
        if (base !== null) roots.push(path === null ? base : resolve(path, base))
      }
      for (const [key, value] of Object.entries(record(domain('worktreeMeta')) ?? {})) {
        const meta = record(value)
        const path = key.split('::').slice(1).join('::')
        if (meta === null || path === '') continue
        worktrees.push({
          tool: 'orca',
          path,
          name: text(meta['displayName']),
          asked: text(meta['comment']),
          pullRequest: pullRequestOf(meta['linkedPR']),
          archived: meta['isArchived'] === true,
          createdAt: isoOf(meta['orcaCreatedAt'] ?? meta['createdAt']),
        })
      }
    }
  }
  return { worktrees, roots: { orca: roots, t3: [], paradev: [] } }
}

/**
 * T3 Code: `userdata/statev2.sqlite`, event-sourced; its threads' projection
 * (`orchestration_v2_projection_threads`, or the older `projection_threads`)
 * names each thread's worktree and branch, its title and its pull request.
 * Its settings may move the worktrees' folder, and keep the old ones.
 */
const t3 = async (places: Places): Promise<Stores> => {
  const settings = record(await readJson(join(places.t3, 'userdata', 'settings.json')))
  const roots = [
    text(settings?.['worktreesDirectory']),
    ...(Array.isArray(settings?.['previousWorktreesDirectories']) ? settings['previousWorktreesDirectories'].map(text) : []),
  ].flatMap((one) => (one === null ? [] : [one]))
  const worktrees =
    (await readCopy(join(places.t3, 'userdata', 'statev2.sqlite'), (db) => {
      const found: Array<Recorded> = []
      if (columnsOf(db, 'orchestration_v2_projection_threads').has('payload_json')) {
        const rows = db
          .prepare(
            `SELECT title, created_at, archived_at, deleted_at, payload_json FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL`,
          )
          .all()
        for (const row of rows) {
          const payload = record(parse(row['payload_json']))
          const path = text(payload?.['worktreePath'])
          if (path === null) continue
          found.push({
            tool: 't_three_code',
            path,
            name: text(row['title']),
            asked: null,
            pullRequest: pullRequestOf(payload?.['linkedPullRequest']),
            archived: row['archived_at'] !== null,
            createdAt: isoOf(row['created_at']),
          })
        }
      } else if (columnsOf(db, 'projection_threads').has('worktree_path')) {
        for (const row of db
          .prepare(`SELECT title, worktree_path, created_at FROM projection_threads WHERE deleted_at IS NULL AND worktree_path IS NOT NULL`)
          .all()) {
          const path = text(row['worktree_path'])
          if (path !== null)
            found.push({
              tool: 't_three_code',
              path,
              name: text(row['title']),
              asked: null,
              pullRequest: null,
              archived: false,
              createdAt: isoOf(row['created_at']),
            })
        }
      }
      return found
    }).catch(() => null)) ?? []
  return { worktrees, roots: { orca: [], t3: roots, paradev: [] } }
}

/**
 * Paradev (Superset renamed): one `host.db` an organisation in `host/`, its
 * `workspaces` naming each worktree, its branch and its pull request; an
 * older install's `local.db` beside it. A project may move its worktrees'
 * folder (`projects.worktree_base_dir`).
 */
const paradev = async (places: Places): Promise<Stores> => {
  const worktrees: Array<Recorded> = []
  const roots: Array<string> = []
  const seen = new Set<string>()
  for (const home of places.paradev) {
    const hosts = await readdir(join(home, 'host')).catch(() => [] as Array<string>)
    for (const file of [...hosts.map((one) => join(home, 'host', one, 'host.db')), join(home, 'local.db')]) {
      const read = await readCopy(file, (db) => {
        const kept: Array<Recorded> = []
        const columns = columnsOf(db, 'workspaces')
        if (!columns.has('worktree_path')) return { kept, bases: [] as Array<string> }
        const pulls = columns.has('pull_request_id') && columnsOf(db, 'pull_requests').has('url')
        const rows = db
          .prepare(
            `SELECT w.worktree_path, ${columns.has('name') ? 'w.name' : 'NULL'} AS name,
              ${columns.has('archived_at') ? 'w.archived_at' : 'NULL'} AS archived_at,
              ${columns.has('created_at') ? 'w.created_at' : 'NULL'} AS created_at,
              ${pulls ? 'p.url, p.pr_number' : 'NULL AS url, NULL AS pr_number'}
            FROM workspaces w ${pulls ? 'LEFT JOIN pull_requests p ON p.id = w.pull_request_id' : ''}`,
          )
          .all()
        for (const row of rows) {
          const path = text(row['worktree_path'])
          if (path === null) continue
          kept.push({
            tool: 'paradev',
            path,
            name: text(row['name']),
            asked: null,
            pullRequest: pullRequestOf({ url: row['url'], number: row['pr_number'] }),
            archived: row['archived_at'] !== null,
            createdAt: isoOf(row['created_at']),
          })
        }
        const bases = columnsOf(db, 'projects').has('worktree_base_dir')
          ? db
              .prepare('SELECT worktree_base_dir FROM projects WHERE worktree_base_dir IS NOT NULL')
              .all()
              .flatMap((row) => text(row['worktree_base_dir']) ?? [])
          : []
        return { kept, bases }
      }).catch(() => null)
      for (const one of read?.kept ?? []) {
        if (seen.has(one.path)) continue
        seen.add(one.path)
        worktrees.push(one)
      }
      roots.push(...(read?.bases ?? []))
    }
  }
  return { worktrees, roots: { orca: [], t3: [], paradev: roots } }
}

/** What every tool's own store says, each read on its own: one that fails says nothing, and the rest are read. */
export const readStores = async (places: Places): Promise<Stores> => {
  const read = await Promise.all([orca(places), t3(places), paradev(places)].map((one) => one.catch(() => null)))
  const all = read.flatMap((one) => (one === null ? [] : [one]))
  return {
    worktrees: all.flatMap((one) => one.worktrees),
    roots: {
      orca: all.flatMap((one) => one.roots.orca),
      t3: all.flatMap((one) => one.roots.t3),
      paradev: all.flatMap((one) => one.roots.paradev),
    },
  }
}
