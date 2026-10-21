import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { GitFailed, NotFound } from './errors'
import { commitOf, git, gitWithin } from './git'
import { Instance } from './Instance'

/*
 * The coordinator's working folder (docs/architecture/04): an Althar-owned
 * folder with a copy of each of the project's repositories, detached at its
 * default branch. Each is brought up to date with the remote before the
 * coordinator's turn, and anything written there is thrown away when it is:
 * nothing the coordinator writes survives or reaches a task. A project with
 * no repositories gets an empty folder.
 *
 * A copy is a repository of its own (ADR-056): its git folder, made again
 * for every turn, borrows the person's repository's objects to read and has
 * that repository for its only remote, so the coordinator's `git fetch` and
 * `git tag` write only the copy, and reach no network. Althar fetches the
 * project's remote into the person's repository first; the copy's fetch
 * brings what that has. Nothing the coordinator left in the git folder, its
 * config, hooks or refs, is ever read by Althar's own git.
 */

export interface CoordinatorFolder {
  readonly folder: string
  /**
   * Each repository's copy: `path` is where the project is in it, its root
   * or the folder inside it the project is about (`within`), and `root` the
   * copy's root.
   */
  readonly repositories: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly root: string
    readonly within: string | null
    readonly base: string
  }>
}

/** What a copy's fetch brings from the person's repository: its branches, each remote's as last fetched, and its tags. */
const MIRRORED = ['+refs/heads/*:refs/heads/*', '+refs/remotes/*:refs/remotes/*', '+refs/tags/*:refs/tags/*']

/** What a path is now, without following a link: the coordinator may have left anything there. */
const kindOf = (path: string): 'none' | 'folder' | 'file' | 'other' => {
  try {
    const found = lstatSync(path)
    return found.isDirectory() ? 'folder' : found.isFile() ? 'file' : 'other'
  } catch {
    return 'none'
  }
}

/**
 * A folder of its own at `path`, and no git folder in it: a link or a file
 * left there goes (only it, never what it points at), and so does the git
 * folder, whatever it is. One a worktree of the repository's left behind, as
 * copies were made before, is dropped from the repository's worktrees too.
 */
const clearedFor = (repository: string, path: string) =>
  Effect.gen(function* () {
    if (kindOf(path) !== 'folder') rmSync(path, { force: true })
    mkdirSync(path, { recursive: true })
    const dotGit = join(path, '.git')
    const linked = kindOf(dotGit) === 'file' && readFileSync(dotGit, 'utf8').startsWith('gitdir: ')
    rmSync(dotGit, { recursive: true, force: true })
    if (linked) yield* git(repository, 'worktree', 'prune').pipe(Effect.ignore)
  }).pipe(Effect.catchDefect((error) => Effect.fail(new GitFailed({ args: ['init'], cwd: path, stderr: String(error) }))))

/**
 * A copy of `repository` at `path`, detached at its default branch as the
 * remote has it, or offline as this computer has it: made if it isn't there, its
 * git folder made again, and anything written in it since thrown away, but
 * what git ignores, such as installed packages.
 */
export const freshCopy = (repository: string, path: string, base: string) =>
  Effect.gen(function* () {
    // Every branch of the remote, so the copy's `git fetch` has them all as of this turn; offline, the repository as it is.
    const fetched = yield* gitWithin(60_000, repository, 'fetch', '--quiet', 'origin').pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    const remote = fetched ? yield* commitOf(repository, `origin/${base}`).pipe(Effect.option) : Option.none()
    const commit = Option.isSome(remote) ? remote.value : yield* commitOf(repository, base)
    const objects = resolve(repository, yield* git(repository, 'rev-parse', '--git-path', 'objects'))
    yield* clearedFor(repository, path)
    // No template: no sample hooks, nothing but what git needs.
    yield* git(path, 'init', '--quiet', '--template=', ...(commit.length === 64 ? ['--object-format=sha256'] : []))
    yield* Effect.try({
      try: () => {
        mkdirSync(join(path, '.git', 'objects', 'info'), { recursive: true })
        writeFileSync(join(path, '.git', 'objects', 'info', 'alternates'), `${objects}\n`)
      },
      catch: (error) => new GitFailed({ args: ['init'], cwd: path, stderr: String(error) }),
    })
    yield* git(path, 'config', 'remote.origin.url', repository)
    for (const refspec of MIRRORED) yield* git(path, 'config', '--add', 'remote.origin.fetch', refspec)
    // A tag made in the copy isn't signed with the person's key, whatever their own config says.
    yield* git(path, 'config', 'tag.gpgSign', 'false')
    yield* git(path, 'config', 'commit.gpgSign', 'false')
    // Its unborn branch may be one it fetches.
    yield* git(path, 'fetch', '--quiet', '--update-head-ok', 'origin')
    yield* git(path, 'checkout', '--quiet', '--detach', '--force', commit)
    yield* git(path, 'clean', '-fdq')
  })

/** The project's coordinator folder, made if it isn't there, and each repository fresh from its default branch. */
export const coordinatorFolder = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const config = yield* RuntimeConfig
    const [project] = yield* sql<{ slug: string }>`SELECT slug FROM projects WHERE id = ${projectId}`
    if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
    const bindings = yield* sql<{ slug: string; name: string; base: string | null; within: string | null; repository: string }>`
      SELECT b.slug, b.display_name AS name, b.default_base_ref AS base, b.folder AS within, l.path AS repository
      FROM repository_bindings b
      JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
      ORDER BY b.created_at, b.rowid`
    const folder = join(config.worktreeRoot, project.slug, '.coordinator')
    mkdirSync(folder, { recursive: true })
    const repositories = yield* Effect.forEach(bindings, (binding) =>
      Effect.gen(function* () {
        const base = binding.base ?? 'main'
        const path = join(folder, binding.slug)
        yield* freshCopy(binding.repository, path, base)
        return {
          name: binding.name,
          path: binding.within === null ? path : join(path, binding.within),
          root: path,
          within: binding.within,
          base,
        }
      }),
    )
    return { folder, repositories } satisfies CoordinatorFolder
  })
