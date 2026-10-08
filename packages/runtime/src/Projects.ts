import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { ProjectInk } from '@althar/contracts'
import {
  ChangeTarget,
  type CommandEnvelope,
  type CommandId,
  Ids,
  newId,
  type ProjectId,
  RepositoryRole,
  type TaskId,
  type ThreadId,
} from '@althar/domain'
import { bumpRevision, Commands, type CommandIdReused, Ledger, type RevisionConflict, type RowNotFound } from '@althar/persistence-sqlite'
import { Context, Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { postCard } from './cards'
import { RuntimeConfig } from './Config'
import { branchFor, conventionsOnBase, ruleOf } from './conventions'
import { type GitFailed, NotARepository, NotFound, ProjectRefused, RepositoriesNeeded } from './errors'
import { type Fork, forkOf } from './forks'
import {
  addWorktree,
  branchExists,
  commitOf,
  currentBranch,
  defaultBranch,
  fetchBranch,
  namedRemotes,
  redactUrl,
  remoteUrls,
  topLevel,
} from './git'
import { Instance } from './Instance'
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

/**
 * A new project's ink, the colour its mark is drawn in: the first, from where
 * its id points, that no other project has, while one is free. It is chosen
 * once, when the project is made, and kept: worked out again, it would change
 * as other projects come and go.
 */
export const inkFor = (seed: string, taken: ReadonlyArray<string>): ProjectInk => {
  const inks = ProjectInk.literals
  // FNV-1a: the same seed always starts at the same ink.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0
  const start = hash % inks.length
  const free = [...inks.slice(start), ...inks.slice(0, start)].find((ink) => !taken.includes(ink))
  return free ?? inks[start] ?? 'clay'
}

/**
 * The role a repository plays, as its name suggests it, for the person to
 * change: `meridian-web` a frontend, `infra` infrastructure. Anything the
 * name doesn't say is other.
 */
export const roleFor = (name: string): RepositoryRole => {
  const words = name.toLowerCase().split(/[^a-z0-9]+/)
  const says = (...some: ReadonlyArray<string>) => words.some((word) => some.includes(word))
  if (says('docs', 'doc', 'documentation', 'handbook', 'guide')) return 'docs'
  if (says('infra', 'infrastructure', 'terraform', 'deploy', 'ops', 'devops', 'k8s', 'helm', 'ansible')) return 'infrastructure'
  if (says('web', 'frontend', 'ui', 'app', 'client', 'www', 'site', 'dashboard')) return 'frontend'
  if (says('lib', 'library', 'sdk', 'core', 'shared', 'common', 'utils', 'kit')) return 'library'
  if (says('api', 'service', 'server', 'backend', 'worker', 'svc')) return 'service'
  return 'other'
}

/** A project's repository, as its Repositories screen shows it: where it is here, and what the project makes of it. */
export interface ProjectRepository {
  readonly id: string
  readonly name: string
  /** Its root on this device; null where this device has none. */
  readonly path: string | null
  /** The folder inside it the project is about, if any. */
  readonly folder: string | null
  readonly branch: string | null
  /** Its first remote, without credentials. */
  readonly remote: string | null
  readonly role: RepositoryRole
  /** The fork its remotes make it, with where its tasks open pull requests: as before, on the fork, until the person says. */
  readonly fork: { readonly fork: string; readonly upstream: string; readonly target: ChangeTarget } | null
  /** Tasks under way that change it, which keep it if it is left out. */
  readonly tasks: number
}

/** The fork a repository's clone is here, read from its remotes; none where it has no clone here, or isn't one. */
const forkAt = (path: string | null): Effect.Effect<Fork | null> =>
  path === null
    ? Effect.succeed(null)
    : namedRemotes(path).pipe(
        Effect.map(forkOf),
        Effect.orElseSucceed(() => null),
      )

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
const prepareWorktree = (
  repository: string,
  base: string,
  planned: { readonly worktree: string; readonly branch: string },
  from = 'origin',
) =>
  Effect.gen(function* () {
    const fetched = yield* fetchBranch(repository, base, from)
    const remote = `${from}/${base}`
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
    /** A project's repositories, as this device has them: each one's branch, remote, role, and the fork it is. */
    repositories(projectId: string): Effect.Effect<ReadonlyArray<ProjectRepository>, NotFound | Failure>
    /** Renames a project. Its slug, and so its worktrees' folders, stay as they were made; its mark stays too. */
    rename(projectId: string, name: string, commandId?: CommandId): Effect.Effect<void, NotFound | ProjectRefused | Failure>
    /**
     * Adds the repositories at a folder to a project, as opening it would find
     * them: the repository it is or is in, whole, or those directly inside it.
     * One it has already stays as it is; one left out before comes back as it
     * was.
     */
    addRepositories(
      projectId: string,
      path: string,
      commandId?: CommandId,
    ): Effect.Effect<void, NotFound | NotARepository | GitFailed | Failure>
    /**
     * Leaves a repository out: new tasks can't change it, and the coordinator
     * no longer reads it. Tasks made with it keep it, and nothing in its
     * folder changes. The last one stays.
     */
    leaveOut(projectId: string, repositoryId: string, commandId?: CommandId): Effect.Effect<void, NotFound | ProjectRefused | Failure>
    /** Sets a repository's role, and for a fork, where its tasks open pull requests. */
    setRepository(input: {
      readonly projectId: string
      readonly repositoryId: string
      readonly role?: string
      readonly changeTarget?: string
      readonly commandId?: CommandId
    }): Effect.Effect<void, NotFound | ProjectRefused | GitFailed | Failure>
    /**
     * Removes a project from Althar: it leaves the window, its plans stop
     * counting down, its runs end and its calls are withdrawn. Its folders,
     * its tasks' worktrees and their branches stay as they are; opening the
     * folder again makes a new project. The agents still on it are the
     * caller's to stop: the threads they are on come back.
     */
    remove(projectId: string, commandId?: CommandId): Effect.Effect<ReadonlyArray<string>, NotFound | Failure>
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
              const inks = yield* sql<{ ink: string }>`SELECT ink FROM projects WHERE archived_at IS NULL`
              const ink = inkFor(
                projectId,
                inks.map((row) => row.ink),
              )
              yield* sql`INSERT INTO projects ${sql.insert({ id: projectId, name, slug, ink, createdByActorId: envelope.actorId, createdAt })}`
              // An archived project lets go of its folder, so the folder can be opened afresh.
              yield* sql`DELETE FROM project_folders WHERE device_id = ${instance.deviceId} AND path = ${path}
                AND project_id IN (SELECT id FROM projects WHERE archived_at IS NOT NULL)`
              yield* sql`INSERT INTO project_folders ${sql.insert({
                id: yield* newId(Ids.projectFolder),
                projectId,
                deviceId: instance.deviceId,
                path,
                createdAt,
              })}`
              const slugs: Array<string> = []
              for (const repository of repositories) {
                const bindingId = yield* newId(Ids.repositoryBinding)
                const bindingSlug = freeSlug(slugify(repository.name, 'repository'), slugs)
                slugs.push(bindingSlug)
                yield* sql`INSERT INTO repository_bindings ${sql.insert({
                  id: bindingId,
                  projectId,
                  slug: bindingSlug,
                  role: roleFor(repository.name),
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

      /** Where a task starts in a repository: its default branch, or, for a fork whose pull requests open on the repository it came from, that repository's. */
      const startOf = (binding: { readonly repository: string; readonly base: string | null; readonly changeTarget: string | null }) =>
        Effect.gen(function* () {
          const upstream = binding.changeTarget === 'upstream' && (yield* forkAt(binding.repository)) !== null
          return upstream
            ? { remote: 'upstream', base: yield* defaultBranch(binding.repository, 'upstream') }
            : { remote: 'origin', base: binding.base ?? 'main' }
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
            changeTarget: string | null
          }>`
            SELECT p.id AS project_id, p.slug AS project_slug, b.id, b.slug, b.display_name AS name, b.default_base_ref AS base,
              l.path AS repository, b.change_target
            FROM projects p
            JOIN repository_bindings b ON b.project_id = p.id AND b.detached_at IS NULL
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE p.id = ${input.projectId} AND p.archived_at IS NULL
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
          // How each repository names branches, read before the task is made (git doesn't run inside it): the person's rule,
          // else what its docs say, else Althar's own.
          const [rules] = yield* sql<{ pattern: string | null }>`
            SELECT json_extract(rules, '$.branchPattern') AS pattern FROM policies WHERE project_id = ${first.projectId}
            ORDER BY revision DESC LIMIT 1`
          const rule = ruleOf('branch', rules?.pattern ?? undefined)
          const patterns = new Map<string, string | null>()
          for (const binding of chosen) {
            if (rule !== null) {
              patterns.set(binding.id, rule)
              continue
            }
            const { remote, base } = yield* startOf(binding)
            patterns.set(binding.id, (yield* conventionsOnBase(binding.repository, base, remote)).branch?.pattern ?? null)
          }
          const created = yield* commands.execute({
            envelope,
            projectId: first.projectId,
            result: CreatedTask,
            handle: Effect.gen(function* () {
              // In the command's transaction, so a removal either came first or cancels what this makes.
              const [live] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${first.projectId} AND archived_at IS NULL`
              if (live === undefined) return yield* new NotFound({ kind: 'project', id: first.projectId })
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
              const branchOf = (bindingId: string) => branchFor(patterns.get(bindingId) ?? null, { key: input.issueKey ?? null, slug })
              // A worktree for each repository it changes, side by side in the task's folder (ADR-006).
              const workspaces: Array<{ id: string; worktree: string; branch: string }> = []
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
                  branch: branchOf(binding.id),
                  state: 'preparing',
                  createdAt,
                })}`
                workspaces.push({ id: workspaceId, worktree, branch: branchOf(binding.id) })
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
              return { taskId, slug, threadId, workspaceId: made?.id ?? '', worktree: made?.worktree ?? '', branch: made?.branch ?? '' }
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
            const { remote, base } = yield* startOf(binding)
            const prepared = yield* Effect.exit(
              prepareWorktree(binding.repository, base, { worktree: workspace.path, branch: workspace.branch }, remote),
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

      /** A project still in the window, and its revision. */
      const projectOf = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ id: ProjectId; revision: number }>`
            SELECT id, revision FROM projects WHERE id = ${projectId} AND archived_at IS NULL`
          return project ?? (yield* new NotFound({ kind: 'project', id: projectId }))
        })

      /** Records a change to a project as one of its own, so every read of the project reads again. */
      const changed = (projectId: string, type: string, payload: unknown, commandId: CommandId | undefined) =>
        Effect.gen(function* () {
          const project = yield* projectOf(projectId)
          const revision = yield* bumpRevision('projects', project.id, project.revision)
          yield* fact({
            projectId: project.id,
            aggregateType: 'project',
            aggregateId: project.id,
            revision,
            type,
            payload,
            actorId: instance.personId,
            ...(commandId === undefined ? {} : { commandId }),
          })
        })

      /** One of a project's repositories still in it. */
      const bindingOf = (projectId: string, repositoryId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [binding] = yield* sql<{ id: string; name: string; path: string | null }>`
            SELECT b.id, b.display_name AS name, l.path FROM repository_bindings b
            LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.id = ${repositoryId} AND b.project_id = ${projectId} AND b.detached_at IS NULL`
          return binding ?? (yield* new NotFound({ kind: 'repository', id: repositoryId }))
        })

      const repositories = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* projectOf(projectId)
          const rows = yield* sql<{
            id: string
            name: string
            path: string | null
            folder: string | null
            role: string
            changeTarget: ChangeTarget | null
            tasks: number
          }>`
            SELECT b.id, b.display_name AS name, l.path, b.folder, b.role, b.change_target,
              (SELECT count(DISTINCT w.task_id) FROM workspaces w JOIN tasks k ON k.id = w.task_id
                WHERE w.binding_id = b.id AND k.state NOT IN ('done', 'abandoned')) AS tasks
            FROM repository_bindings b
            LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
            ORDER BY b.created_at, b.rowid`
          return yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const here = row.path === null ? null : yield* describe(row.path, row.folder)
              const fork = yield* forkAt(row.path)
              return {
                id: row.id,
                name: row.name,
                path: row.path,
                folder: row.folder,
                branch: here?.branch ?? null,
                remote: here?.remote ?? null,
                role: Schema.is(RepositoryRole)(row.role) ? row.role : 'other',
                fork:
                  fork === null
                    ? null
                    : { fork: fork.fork.path.join('/'), upstream: fork.upstream.path.join('/'), target: row.changeTarget ?? 'fork' },
                tasks: row.tasks,
              } satisfies ProjectRepository
            }),
          )
        })

      const rename = (projectId: string, name: string, commandId?: CommandId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const trimmed = name.trim()
          if (trimmed === '') return yield* new ProjectRefused({ reason: 'no_name' })
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const project = yield* projectOf(projectId)
              const revision = yield* change('projects', project.id, { name: trimmed })
              yield* fact({
                projectId: project.id,
                aggregateType: 'project',
                aggregateId: project.id,
                revision,
                type: 'project.renamed',
                payload: { name: trimmed },
                actorId: instance.personId,
                ...(commandId === undefined ? {} : { commandId }),
              })
            }),
          )
        })

      const addRepositories = (projectId: string, path: string, commandId?: CommandId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* projectOf(projectId)
          const reading = yield* readFolder(path)
          if (reading.repositories.length === 0) return yield* new NotARepository({ path })
          // Each is added whole: a folder inside one adds the repository it is in.
          const found = yield* Effect.forEach(reading.repositories, (repository) =>
            Effect.gen(function* () {
              return {
                ...repository,
                folder: null,
                remotes: yield* remoteUrls(repository.path),
                base: yield* defaultBranch(repository.path),
              }
            }),
          )
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const createdAt = yield* timestamp
              const bindings = yield* sql<{
                id: string
                slug: string
                path: string | null
                detachedAt: string | null
              }>`
                SELECT b.id, b.slug, l.path, b.detached_at FROM repository_bindings b
                LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
                WHERE b.project_id = ${projectId}`
              const slugs = bindings.map((binding) => binding.slug)
              const added: Array<string> = []
              for (const repository of found) {
                // Known by its root, whatever folder in it the project was opened at.
                const known = bindings.find((binding) => binding.path === repository.path)
                if (known !== undefined) {
                  // One left out before comes back, with its role and slug, so its tasks' worktrees still name it.
                  if (known.detachedAt !== null) {
                    yield* sql`UPDATE repository_bindings SET detached_at = NULL WHERE id = ${known.id}`
                    added.push(repository.name)
                  }
                  continue
                }
                const bindingId = yield* newId(Ids.repositoryBinding)
                const slug = freeSlug(slugify(repository.name, 'repository'), slugs)
                slugs.push(slug)
                yield* sql`INSERT INTO repository_bindings ${sql.insert({
                  id: bindingId,
                  projectId,
                  slug,
                  role: roleFor(repository.name),
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
                added.push(repository.name)
              }
              if (added.length > 0) yield* changed(projectId, 'project.repositories_added', { repositories: added }, commandId)
            }),
          )
        })

      const leaveOut = (projectId: string, repositoryId: string, commandId?: CommandId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const binding = yield* bindingOf(projectId, repositoryId)
              const [others] = yield* sql<{ n: number }>`
                SELECT count(*) AS n FROM repository_bindings WHERE project_id = ${projectId} AND detached_at IS NULL AND id <> ${binding.id}`
              if ((others?.n ?? 0) === 0) return yield* new ProjectRefused({ reason: 'last_repository' })
              yield* sql`UPDATE repository_bindings SET detached_at = ${yield* timestamp} WHERE id = ${binding.id}`
              yield* changed(projectId, 'project.repository_left_out', { repository: binding.name }, commandId)
            }),
          )
        })

      const setRepository = (input: {
        readonly projectId: string
        readonly repositoryId: string
        readonly role?: string
        readonly changeTarget?: string
        readonly commandId?: CommandId
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const binding = yield* bindingOf(input.projectId, input.repositoryId)
          const role = input.role
          if (role !== undefined && !Schema.is(RepositoryRole)(role)) return yield* new ProjectRefused({ reason: 'no_role' })
          const target = input.changeTarget
          if (target !== undefined && (!Schema.is(ChangeTarget)(target) || (yield* forkAt(binding.path)) === null))
            return yield* new ProjectRefused({ reason: 'not_a_fork' })
          const set = { ...(role === undefined ? {} : { role }), ...(target === undefined ? {} : { changeTarget: target }) }
          if (Object.keys(set).length === 0) return
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE repository_bindings SET ${sql.update(set)} WHERE id = ${binding.id}`
              yield* changed(input.projectId, 'project.repository_changed', { repository: binding.name, ...set }, input.commandId)
            }),
          )
        })

      const remove = (projectId: string, commandId?: CommandId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const project = yield* projectOf(projectId)
              const at = yield* timestamp
              // Nothing it planned starts: each plan still proposed is declined, its countdown with it.
              const proposed = yield* sql<{ id: string }>`
                SELECT id FROM task_plans WHERE project_id = ${project.id} AND state = 'proposed'`
              for (const plan of proposed) {
                const revision = yield* change('task_plans', plan.id, { state: 'declined', startsAt: null, decidedAt: at })
                yield* fact({
                  projectId: project.id,
                  aggregateType: 'task_plan',
                  aggregateId: plan.id,
                  revision,
                  type: 'task_plan.declined',
                  actorId: instance.personId,
                })
              }
              // Its calls go: there is no one left to answer them.
              const calls = yield* sql<{ id: string }>`
                SELECT id FROM attention_requests WHERE project_id = ${project.id} AND state = 'open'`
              for (const call of calls) {
                const revision = yield* change('attention_requests', call.id, { state: 'withdrawn' })
                yield* fact({
                  projectId: project.id,
                  aggregateType: 'attention_request',
                  aggregateId: call.id,
                  revision,
                  type: 'attention_request.withdrawn',
                  actorId: instance.personId,
                })
              }
              // Its runs end, cancelled, with the steps they were on: no step is told to carry on, or handed to another agent.
              const runs = yield* sql<{ id: string }>`
                SELECT id FROM runs WHERE project_id = ${project.id} AND state IN ('admitted', 'running', 'suspended')`
              for (const runRow of runs) {
                const attempts = yield* sql<{ id: string }>`
                  SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                  WHERE e.run_id = ${runRow.id} AND a.state IN ('ready', 'admitted', 'running', 'waiting_attention', 'verifying', 'held', 'reconciling')`
                for (const attempt of attempts) yield* change('node_attempts', attempt.id, { state: 'cancelled', endedAt: at })
                const live = yield* sql<{ id: string; kind: 'run_attempts' | 'workflow_executions' }>`
                  SELECT id, 'run_attempts' AS kind FROM run_attempts WHERE run_id = ${runRow.id} AND state = 'active'
                  UNION ALL SELECT id, 'workflow_executions' AS kind FROM workflow_executions WHERE run_id = ${runRow.id} AND state = 'running'`
                for (const row of live) yield* change(row.kind, row.id, { state: 'cancelled', endedAt: at })
                const revision = yield* change('runs', runRow.id, { state: 'cancelled', endedAt: at })
                yield* fact({
                  projectId: project.id,
                  aggregateType: 'run',
                  aggregateId: runRow.id,
                  revision,
                  type: 'run.cancelled',
                  payload: { projectRemoved: true },
                  actorId: instance.personId,
                })
              }
              const revision = yield* change('projects', project.id, { archivedAt: at })
              yield* fact({
                projectId: project.id,
                aggregateType: 'project',
                aggregateId: project.id,
                revision,
                type: 'project.removed',
                actorId: instance.personId,
                ...(commandId === undefined ? {} : { commandId }),
              })
              // The threads agents may still be on, for the caller to stop.
              const threads = yield* sql<{
                threadId: string
              }>`SELECT DISTINCT thread_id FROM provider_sessions WHERE project_id = ${project.id}`
              return threads.map((thread) => thread.threadId)
            }),
          )
        })

      return Projects.of({
        read: (path) => run(read(path)),
        open: (input) => run(open(input)),
        createTask: (input) => run(createTask(input)),
        repositories: (projectId) => run(repositories(projectId)),
        rename: (projectId, name, commandId) => run(rename(projectId, name, commandId)),
        addRepositories: (projectId, path, commandId) => run(addRepositories(projectId, real(path), commandId)),
        leaveOut: (projectId, repositoryId, commandId) => run(leaveOut(projectId, repositoryId, commandId)),
        setRepository: (input) => run(setRepository(input)),
        remove: (projectId, commandId) => run(remove(projectId, commandId)),
      })
    }),
  )
}
