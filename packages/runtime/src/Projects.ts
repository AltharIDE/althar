import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { type CommandEnvelope, Ids, newId, type ProjectId, type TaskId, type ThreadId } from '@althar/domain'
import { Commands, type CommandIdReused, Ledger, type RevisionConflict, type RowNotFound } from '@althar/persistence-sqlite'
import { Context, Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { postCard } from './cards'
import { RuntimeConfig } from './Config'
import { type GitFailed, NotARepository, NotFound, RepositoriesNeeded } from './errors'
import { addWorktree, branchExists, commitOf, currentBranch, defaultBranch, fetchBranch, redactUrl, remoteUrls, topLevel } from './git'
import { Instance } from './Instance'
import { branchKey } from './Issues'
import { change, fact, timestamp } from './records'

/*
 * Projects and tasks (docs/architecture/01). Opening a folder makes it a
 * project: of the repository it is, of a folder inside one (one package of a
 * monorepo, say), or of the repositories directly inside it, as many as the
 * person keeps. A task gets its own thread, and a worktree of its own on a
 * branch of its own (ADR-006).
 *
 * Git runs outside the store's transactions: the facts are read first, and a
 * task's worktree is added after the task is committed, its workspace marked
 * ready or failed once git has finished.
 */

/** A repository found where a folder was opened: its root, the folder inside it the project is about, if any, and what it is. */
export interface Found {
  readonly path: string
  readonly folder: string | null
  readonly name: string
  readonly branch: string | null
  readonly remote: string | null
}

/** What opening a folder would make, read before anything is. */
export interface Reading {
  readonly kind: 'repository' | 'inside' | 'folder'
  readonly name: string
  readonly repositories: ReadonlyArray<Found>
  readonly project: { readonly id: string; readonly name: string } | null
}

/** The path as the file system has it, without symbolic links, as git names a repository's root. */
const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** A repository's root, as read: its name, the branch checked out, and its first remote, without a password. */
const describe = (root: string, folder: string | null) =>
  Effect.gen(function* () {
    const remotes = yield* remoteUrls(root).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
    const first = remotes[0]
    return {
      path: root,
      folder,
      name: basename(root),
      branch: (yield* currentBranch(root)) ?? null,
      remote: first === undefined ? null : redactUrl(first),
    } satisfies Found
  })

/** The repository `path` is the root of, or none. */
const rootAt = (path: string) =>
  topLevel(path).pipe(
    Effect.map((root) => (real(root) === real(path) ? real(root) : null)),
    Effect.orElseSucceed(() => null),
  )

/**
 * What a folder is, read without changing it: a repository, a folder inside
 * one, or a folder whose git repositories are directly inside it, one level
 * down and no further. Hidden folders aren't looked in.
 */
export const readFolder = (opened: string) =>
  Effect.gen(function* () {
    const path = real(opened)
    const root = yield* topLevel(path).pipe(
      Effect.map(real),
      Effect.orElseSucceed(() => null),
    )
    if (root !== null)
      return root === path
        ? { kind: 'repository' as const, name: basename(path), repositories: [yield* describe(root, null)] }
        : { kind: 'inside' as const, name: basename(path), repositories: [yield* describe(root, relative(root, path))] }
    let entries: ReadonlyArray<string> = []
    try {
      entries = readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .toSorted()
    } catch {
      entries = []
    }
    const repositories: Array<Found> = []
    for (const entry of entries) {
      const found = yield* rootAt(join(path, entry))
      if (found !== null) repositories.push(yield* describe(found, null))
    }
    return { kind: 'folder' as const, name: basename(path), repositories }
  })

export const OpenedProject = Schema.Struct({
  projectId: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  repository: Schema.String,
  coordinatorThreadId: Schema.String,
})
export type OpenedProject = typeof OpenedProject.Type

export const CreatedTask = Schema.Struct({
  taskId: Schema.String,
  slug: Schema.String,
  threadId: Schema.String,
  workspaceId: Schema.String,
  worktree: Schema.String,
  branch: Schema.String,
})
export type CreatedTask = typeof CreatedTask.Type

/** A slug from a name: lowercase letters, digits and dashes. */
export const slugify = (name: string, fallback: string) => {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return slug === '' ? fallback : slug
}

/** The first of `slug`, `slug-2`, `slug-3`… that isn't taken. */
const freeSlug = (slug: string, taken: ReadonlyArray<string>) => {
  if (!taken.includes(slug)) return slug
  for (let n = 2; ; n += 1) if (!taken.includes(`${slug}-${n}`)) return `${slug}-${n}`
}

/**
 * Adds a task's worktree. The base is the default branch as origin has it now:
 * fetched first, so the task doesn't start from a stale commit (and its pull
 * request doesn't conflict for that reason), falling back to the local branch
 * when origin can't be reached. A branch or folder that already exists, from
 * another project on the same repository or an earlier profile, gets the next
 * free name instead of failing.
 */
const prepareWorktree = (repository: string, base: string, planned: { readonly worktree: string; readonly branch: string }) =>
  Effect.gen(function* () {
    const fetched = yield* fetchBranch(repository, base)
    const remote = `origin/${base}`
    const fromRemote = fetched ? yield* commitOf(repository, remote).pipe(Effect.option) : Option.none()
    const baseRef = Option.isSome(fromRemote) ? remote : base
    const baseCommit = Option.isSome(fromRemote)
      ? fromRemote.value
      : yield* commitOf(repository, base).pipe(Effect.catch(() => commitOf(repository, remote)))
    let branch = planned.branch
    let worktree = planned.worktree
    for (let n = 2; (yield* branchExists(repository, branch)) || existsSync(worktree); n += 1) {
      branch = `${planned.branch}-${n}`
      worktree = `${planned.worktree}-${n}`
    }
    yield* addWorktree(repository, worktree, branch, baseCommit)
    return { worktree, branch, baseRef, baseCommit, fetched }
  })

type Store = SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto | Instance | RuntimeConfig
type Failure = SqlError.SqlError | Schema.SchemaError | CommandIdReused | RowNotFound | RevisionConflict

export class Projects extends Context.Service<
  Projects,
  {
    /** What opening a folder would make, and the project it already is, read without changing anything. */
    read(path: string): Effect.Effect<Reading, Failure>
    /**
     * Opens a folder as a project, or finds the project it already is: the
     * repository it is or is in, or the repositories directly inside it, all
     * of them unless `repositories` names the roots the person kept (which
     * may include ones they added from elsewhere).
     */
    open(input: {
      readonly envelope: CommandEnvelope
      readonly path: string
      readonly name?: string
      readonly repositories?: ReadonlyArray<string>
    }): Effect.Effect<OpenedProject, NotARepository | GitFailed | Failure>
    /**
     * Creates a task, its thread, and its worktree. A draft is a task the
     * coordinator planned, which starts when its plan does; its worktree is
     * made now, so it is ready by then.
     */
    createTask(input: {
      readonly envelope: CommandEnvelope
      readonly projectId: string
      readonly title: string
      readonly description?: string
      readonly draft?: boolean
      /** The key of the issue it comes from, which its branch carries, so the tracker's own Git integration finds it. */
      readonly issueKey?: string
      /** The project's repositories it changes, by name; needed only where it has several. */
      readonly repositories?: ReadonlyArray<string>
    }): Effect.Effect<CreatedTask, NotFound | RepositoriesNeeded | GitFailed | Failure>
  }
>()('@althar/runtime/Projects') {
  static readonly layer: Layer.Layer<Projects, never, Store> = Layer.effect(
    Projects,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const config = yield* RuntimeConfig
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      /** The project already opened at a folder on this device. One opened before folders were kept is known by its repository's root. */
      const knownAt = (path: string, kind: Reading['kind']) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [byFolder] = yield* sql<{ projectId: ProjectId; slug: string; name: string; threadId: ThreadId }>`
            SELECT p.id AS project_id, p.slug, p.name, t.id AS thread_id FROM project_folders f
            JOIN projects p ON p.id = f.project_id
            JOIN threads t ON t.project_id = p.id AND t.kind = 'coordinator' AND t.owner_actor_id = ${instance.personId}
            WHERE f.path = ${path} AND f.device_id = ${instance.deviceId} AND p.archived_at IS NULL`
          if (byFolder !== undefined || kind !== 'repository') return byFolder
          const [byRoot] = yield* sql<{ projectId: ProjectId; slug: string; name: string; threadId: ThreadId }>`
            SELECT p.id AS project_id, p.slug, p.name, t.id AS thread_id FROM repository_locations l
            JOIN projects p ON p.id = l.project_id
            JOIN threads t ON t.project_id = p.id AND t.kind = 'coordinator' AND t.owner_actor_id = ${instance.personId}
            WHERE l.path = ${path} AND l.device_id = ${instance.deviceId} AND p.archived_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM project_folders f WHERE f.project_id = p.id)`
          return byRoot
        })

      const read = (opened: string) =>
        Effect.gen(function* () {
          const reading = yield* readFolder(opened)
          const known = yield* knownAt(real(opened), reading.kind)
          return { ...reading, project: known === undefined ? null : { id: known.projectId, name: known.name } } satisfies Reading
        })

      const open = (input: {
        readonly envelope: CommandEnvelope
        readonly path: string
        readonly name?: string
        readonly repositories?: ReadonlyArray<string>
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const { envelope } = input
          const path = real(input.path)
          const reading = yield* readFolder(path)
          const known = yield* knownAt(path, reading.kind)
          if (known !== undefined) {
            return { projectId: known.projectId, slug: known.slug, name: known.name, repository: path, coordinatorThreadId: known.threadId }
          }
          // The ones the person kept, as read here, or roots they added from elsewhere; each must still be a repository's root.
          const chosen: Array<Found> = []
          for (const root of input.repositories ?? reading.repositories.map((found) => found.path)) {
            const found = reading.repositories.find((candidate) => candidate.path === real(root))
            if (found !== undefined) chosen.push(found)
            else {
              const at = yield* rootAt(root)
              if (at !== null && !chosen.some((other) => other.path === at)) chosen.push(yield* describe(at, null))
            }
          }
          // Said as the person chose it, not as the file system resolves it.
          if (chosen.length === 0) return yield* new NotARepository({ path: input.path })
          const repositories = yield* Effect.forEach(chosen, (found) =>
            Effect.gen(function* () {
              return { ...found, remotes: yield* remoteUrls(found.path), base: yield* defaultBranch(found.path) }
            }),
          )
          const name = input.name?.trim() || reading.name
          return yield* commands.execute({
            envelope,
            result: OpenedProject,
            handle: Effect.gen(function* () {
              const createdAt = yield* timestamp
              const projectId = yield* newId(Ids.project)
              const taken = yield* sql<{ slug: string }>`SELECT slug FROM projects`
              const slug = freeSlug(
                slugify(name, 'project'),
                taken.map((row) => row.slug),
              )
              yield* sql`INSERT INTO projects ${sql.insert({ id: projectId, name, slug, createdByActorId: envelope.actorId, createdAt })}`
              yield* sql`INSERT INTO project_folders ${sql.insert({
                id: yield* newId(Ids.projectFolder),
                projectId,
                deviceId: instance.deviceId,
                path,
                createdAt,
              })}`
              const slugs: Array<string> = []
              for (const [index, repository] of repositories.entries()) {
                const bindingId = yield* newId(Ids.repositoryBinding)
                const bindingSlug = freeSlug(slugify(repository.name, 'repository'), slugs)
                slugs.push(bindingSlug)
                yield* sql`INSERT INTO repository_bindings ${sql.insert({
                  id: bindingId,
                  projectId,
                  slug: bindingSlug,
                  role: index === 0 ? 'primary' : 'repository',
                  displayName: repository.name,
                  remoteFingerprints: JSON.stringify(repository.remotes),
                  defaultBaseRef: repository.base,
                  folder: repository.folder,
                  createdAt,
                })}`
                yield* sql`INSERT INTO repository_locations ${sql.insert({
                  id: yield* newId(Ids.repositoryLocation),
                  projectId,
                  bindingId,
                  deviceId: instance.deviceId,
                  kind: 'existing',
                  path: repository.path,
                  observedRemotes: JSON.stringify(repository.remotes),
                  state: 'ready',
                  verifiedAt: createdAt,
                  createdAt,
                })}`
              }
              const coordinatorThreadId = yield* newId(Ids.thread)
              yield* sql`INSERT INTO threads ${sql.insert({ id: coordinatorThreadId, projectId, kind: 'coordinator', ownerActorId: instance.personId, createdAt })}`
              yield* fact({
                projectId,
                aggregateType: 'project',
                aggregateId: projectId,
                revision: 1,
                type: 'project.opened',
                payload: {
                  name,
                  folder: path,
                  repositories: repositories.map((repository) => ({
                    name: repository.name,
                    path: repository.path,
                    folder: repository.folder,
                    remotes: repository.remotes,
                    defaultBranch: repository.base,
                  })),
                },
                actorId: envelope.actorId,
                commandId: envelope.commandId,
              })
              return { projectId, slug, name, repository: path, coordinatorThreadId }
            }),
          })
        })

      const createTask = (input: {
        readonly envelope: CommandEnvelope
        readonly projectId: string
        readonly title: string
        readonly description?: string
        readonly draft?: boolean
        readonly issueKey?: string
        readonly repositories?: ReadonlyArray<string>
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const { envelope } = input
          const bindings = yield* sql<{
            projectId: ProjectId
            projectSlug: string
            id: string
            slug: string
            name: string
            base: string | null
            repository: string
          }>`
            SELECT p.id AS project_id, p.slug AS project_slug, b.id, b.slug, b.display_name AS name, b.default_base_ref AS base,
              l.path AS repository
            FROM projects p
            JOIN repository_bindings b ON b.project_id = p.id AND b.detached_at IS NULL
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE p.id = ${input.projectId}
            ORDER BY b.created_at, b.rowid`
          const [first] = bindings
          if (first === undefined) return yield* new NotFound({ kind: 'project', id: input.projectId })
          // The repositories it changes: the project's one, or the ones it names, by name or slug, in the project's order.
          const named = (input.repositories ?? []).map((name) => name.trim().toLowerCase()).filter((name) => name !== '')
          const matches = (binding: (typeof bindings)[number], name: string) => binding.slug === name || binding.name.toLowerCase() === name
          const unknown = named.filter((name) => !bindings.some((binding) => matches(binding, name)))
          const choices = bindings.map((binding) => binding.name)
          if (unknown.length > 0) return yield* new RepositoriesNeeded({ unknown, choices })
          const chosen = bindings.length === 1 ? bindings : bindings.filter((binding) => named.some((name) => matches(binding, name)))
          if (chosen.length === 0) return yield* new RepositoriesNeeded({ unknown: [], choices })
          const created = yield* commands.execute({
            envelope,
            projectId: first.projectId,
            result: CreatedTask,
            handle: Effect.gen(function* () {
              const createdAt = yield* timestamp
              const taskId: TaskId = yield* newId(Ids.task)
              const taken = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE project_id = ${first.projectId}`
              const slug = freeSlug(
                slugify(input.title, 'task'),
                taken.map((row) => row.slug),
              )
              yield* sql`INSERT INTO tasks ${sql.insert({
                id: taskId,
                projectId: first.projectId,
                title: input.title,
                description: input.description ?? '',
                slug,
                state: input.draft === true ? 'draft' : 'open',
                createdByActorId: envelope.actorId,
                createdAt,
              })}`
              const threadId = yield* newId(Ids.thread)
              yield* sql`INSERT INTO threads ${sql.insert({ id: threadId, projectId: first.projectId, kind: 'task', taskId, createdAt })}`
              const branch = input.issueKey === undefined ? `althar/${slug}` : `althar/${branchKey(input.issueKey)}-${slug}`
              // A worktree for each repository it changes, side by side in the task's folder (ADR-006).
              const workspaces: Array<{ id: string; worktree: string }> = []
              for (const binding of chosen) {
                yield* sql`INSERT INTO task_repository_requirements ${sql.insert({
                  id: yield* newId(Ids.taskRequirement),
                  projectId: first.projectId,
                  taskId,
                  bindingId: binding.id,
                  access: 'write',
                  baseRef: binding.base,
                })}`
                const workspaceId = yield* newId(Ids.workspace)
                const worktree = join(config.worktreeRoot, first.projectSlug, slug, binding.slug)
                yield* sql`INSERT INTO workspaces ${sql.insert({
                  id: workspaceId,
                  projectId: first.projectId,
                  taskId,
                  bindingId: binding.id,
                  deviceId: instance.deviceId,
                  access: 'write',
                  path: worktree,
                  baseRef: binding.base ?? 'main',
                  branch,
                  state: 'preparing',
                  createdAt,
                })}`
                workspaces.push({ id: workspaceId, worktree })
              }
              yield* fact({
                projectId: first.projectId,
                aggregateType: 'task',
                aggregateId: taskId,
                revision: 1,
                type: 'task.created',
                payload: { title: input.title, repositories: chosen.map((binding) => binding.slug) },
                actorId: envelope.actorId,
                commandId: envelope.commandId,
              })
              // A task started by hand shows in the coordinator's thread as its card; a draft's card comes with its plan.
              if (input.draft !== true) yield* postCard(first.projectId, taskId)
              const [made] = workspaces
              return { taskId, slug, threadId, workspaceId: made?.id ?? '', worktree: made?.worktree ?? '', branch }
            }),
          })

          // The worktrees, after the task is committed: each one marked ready, or failed, once git has finished with it.
          const planned = yield* sql<{ id: string; bindingId: string; state: string; path: string; branch: string }>`
            SELECT w.id, w.binding_id, w.state, w.path, w.branch FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${created.taskId} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
          const ready: Array<{ worktree: string; branch: string }> = []
          for (const workspace of planned) {
            if (workspace.state === 'ready') {
              ready.push({ worktree: workspace.path, branch: workspace.branch })
              continue
            }
            const binding = bindings.find((candidate) => candidate.id === workspace.bindingId) ?? first
            const base = binding.base ?? 'main'
            const prepared = yield* Effect.exit(
              prepareWorktree(binding.repository, base, { worktree: workspace.path, branch: workspace.branch }),
            )
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const done = prepared._tag === 'Success'
                const revision = yield* change(
                  'workspaces',
                  workspace.id,
                  done
                    ? {
                        state: 'ready',
                        baseRef: prepared.value.baseRef,
                        baseCommit: prepared.value.baseCommit,
                        path: prepared.value.worktree,
                        branch: prepared.value.branch,
                      }
                    : { state: 'failed' },
                )
                yield* fact({
                  projectId: binding.projectId,
                  aggregateType: 'workspace',
                  aggregateId: workspace.id,
                  revision,
                  type: done ? 'workspace.ready' : 'workspace.failed',
                  payload: done ? prepared.value : { path: workspace.path },
                  actorId: instance.systemId,
                })
              }),
            )
            if (prepared._tag === 'Failure') return yield* Effect.failCause(prepared.cause)
            ready.push({ worktree: prepared.value.worktree, branch: prepared.value.branch })
          }
          const [made] = ready
          return made === undefined ? created : { ...created, worktree: made.worktree, branch: made.branch }
        })

      return Projects.of({
        read: (path) => run(read(path)),
        open: (input) => run(open(input)),
        createTask: (input) => run(createTask(input)),
      })
    }),
  )
}
