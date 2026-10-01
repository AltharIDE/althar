import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

import { type CommandEnvelope, Ids, newId, type ProjectId, type TaskId, type ThreadId } from '@charrette/domain'
import { Commands, type CommandIdReused, Ledger, type RevisionConflict, type RowNotFound } from '@charrette/persistence-sqlite'
import { Context, Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { postCard } from './cards'
import { RuntimeConfig } from './Config'
import { type GitFailed, NotARepository, NotFound } from './errors'
import { addWorktree, branchExists, commitOf, defaultBranch, fetchBranch, remoteUrls, topLevel } from './git'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'

/*
 * Projects and tasks (docs/architecture/01). Opening a folder makes it a
 * project with one repository. A task gets its own thread, and a worktree of
 * its own on a branch of its own (ADR-006).
 *
 * Git runs outside the store's transactions: the facts are read first, and a
 * task's worktree is added after the task is committed, its workspace marked
 * ready or failed once git has finished.
 */

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
    /** Opens a folder in a git repository as a project, or finds the project it already is. */
    open(input: {
      readonly envelope: CommandEnvelope
      readonly path: string
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
    }): Effect.Effect<CreatedTask, NotFound | GitFailed | Failure>
  }
>()('@charrette/runtime/Projects') {
  static readonly layer: Layer.Layer<Projects, never, Store> = Layer.effect(
    Projects,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const config = yield* RuntimeConfig
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const open = ({ envelope, path }: { readonly envelope: CommandEnvelope; readonly path: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const repository = yield* topLevel(path).pipe(Effect.mapError(() => new NotARepository({ path })))
          const [known] = yield* sql<{ projectId: ProjectId; slug: string; name: string; threadId: ThreadId }>`
            SELECT p.id AS project_id, p.slug, p.name, t.id AS thread_id FROM repository_locations l
            JOIN projects p ON p.id = l.project_id
            JOIN threads t ON t.project_id = p.id AND t.kind = 'coordinator' AND t.owner_actor_id = ${instance.personId}
            WHERE l.path = ${repository} AND l.device_id = ${instance.deviceId} AND p.archived_at IS NULL`
          if (known !== undefined) {
            return { projectId: known.projectId, slug: known.slug, name: known.name, repository, coordinatorThreadId: known.threadId }
          }
          const remotes = yield* remoteUrls(repository)
          const base = yield* defaultBranch(repository)
          const name = basename(repository)
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
              const bindingId = yield* newId(Ids.repositoryBinding)
              yield* sql`INSERT INTO repository_bindings ${sql.insert({
                id: bindingId,
                projectId,
                slug: slugify(name, 'repository'),
                role: 'primary',
                displayName: name,
                remoteFingerprints: JSON.stringify(remotes),
                defaultBaseRef: base,
                createdAt,
              })}`
              yield* sql`INSERT INTO repository_locations ${sql.insert({
                id: yield* newId(Ids.repositoryLocation),
                projectId,
                bindingId,
                deviceId: instance.deviceId,
                kind: 'existing',
                path: repository,
                observedRemotes: JSON.stringify(remotes),
                state: 'ready',
                verifiedAt: createdAt,
                createdAt,
              })}`
              const coordinatorThreadId = yield* newId(Ids.thread)
              yield* sql`INSERT INTO threads ${sql.insert({ id: coordinatorThreadId, projectId, kind: 'coordinator', ownerActorId: instance.personId, createdAt })}`
              yield* fact({
                projectId,
                aggregateType: 'project',
                aggregateId: projectId,
                revision: 1,
                type: 'project.opened',
                payload: { name, repository, remotes, defaultBranch: base },
                actorId: envelope.actorId,
                commandId: envelope.commandId,
              })
              return { projectId, slug, name, repository, coordinatorThreadId }
            }),
          })
        })

      const createTask = (input: {
        readonly envelope: CommandEnvelope
        readonly projectId: string
        readonly title: string
        readonly description?: string
        readonly draft?: boolean
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const { envelope } = input
          const [project] = yield* sql<{
            id: ProjectId
            slug: string
            bindingId: string
            bindingSlug: string
            base: string | null
            repository: string
          }>`
            SELECT p.id, p.slug, b.id AS binding_id, b.slug AS binding_slug, b.default_base_ref AS base, l.path AS repository
            FROM projects p
            JOIN repository_bindings b ON b.project_id = p.id AND b.detached_at IS NULL
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE p.id = ${input.projectId}
            ORDER BY b.created_at LIMIT 1`
          if (project === undefined) return yield* new NotFound({ kind: 'project', id: input.projectId })
          const base = project.base ?? 'main'
          const created = yield* commands.execute({
            envelope,
            projectId: project.id,
            result: CreatedTask,
            handle: Effect.gen(function* () {
              const createdAt = yield* timestamp
              const taskId: TaskId = yield* newId(Ids.task)
              const taken = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE project_id = ${project.id}`
              const slug = freeSlug(
                slugify(input.title, 'task'),
                taken.map((row) => row.slug),
              )
              yield* sql`INSERT INTO tasks ${sql.insert({
                id: taskId,
                projectId: project.id,
                title: input.title,
                description: input.description ?? '',
                slug,
                state: input.draft === true ? 'draft' : 'open',
                createdByActorId: envelope.actorId,
                createdAt,
              })}`
              const threadId = yield* newId(Ids.thread)
              yield* sql`INSERT INTO threads ${sql.insert({ id: threadId, projectId: project.id, kind: 'task', taskId, createdAt })}`
              const workspaceId = yield* newId(Ids.workspace)
              const worktree = join(config.worktreeRoot, project.slug, slug, project.bindingSlug)
              const branch = `charrette/${slug}`
              yield* sql`INSERT INTO workspaces ${sql.insert({
                id: workspaceId,
                projectId: project.id,
                taskId,
                bindingId: project.bindingId,
                deviceId: instance.deviceId,
                access: 'write',
                path: worktree,
                baseRef: base,
                branch,
                state: 'preparing',
                createdAt,
              })}`
              yield* fact({
                projectId: project.id,
                aggregateType: 'task',
                aggregateId: taskId,
                revision: 1,
                type: 'task.created',
                payload: { title: input.title },
                actorId: envelope.actorId,
                commandId: envelope.commandId,
              })
              // A task started by hand shows in the coordinator's thread as its card; a draft's card comes with its plan.
              if (input.draft !== true) yield* postCard(project.id, taskId)
              return { taskId, slug, threadId, workspaceId, worktree, branch }
            }),
          })

          // The worktree, after the task is committed.
          const [workspace] = yield* sql<{ state: string; path: string; branch: string }>`
            SELECT state, path, branch FROM workspaces WHERE id = ${created.workspaceId}`
          if (workspace?.state === 'ready') return { ...created, worktree: workspace.path, branch: workspace.branch }
          const prepared = yield* Effect.exit(prepareWorktree(project.repository, base, created))
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const ready = prepared._tag === 'Success'
              const revision = yield* change(
                'workspaces',
                created.workspaceId,
                ready
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
                projectId: project.id,
                aggregateType: 'workspace',
                aggregateId: created.workspaceId,
                revision,
                type: ready ? 'workspace.ready' : 'workspace.failed',
                payload: ready ? prepared.value : { path: created.worktree },
                actorId: instance.systemId,
              })
            }),
          )
          if (prepared._tag === 'Failure') return yield* Effect.failCause(prepared.cause)
          return { ...created, worktree: prepared.value.worktree, branch: prepared.value.branch }
        })

      return Projects.of({ open: (input) => run(open(input)), createTask: (input) => run(createTask(input)) })
    }),
  )
}
