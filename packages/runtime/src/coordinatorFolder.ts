import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

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
 * A copy is a repository of its own (ADR-058): its git folder, made again
 * for every turn, borrows the person's repository's objects to read, and its
 * only remote is a bare mirror of that repository's refs Althar keeps beside
 * the folder, out of the coordinator's reach. So the coordinator's `git
 * fetch` and `git tag` write only the copy, and reach no network, nor the
 * person's checkout. Althar fetches the project's remote into the person's
 * repository first, and its refs into the mirror; the copy's fetch brings
 * what that has. Nothing the coordinator left in the git folder, its config,
 * hooks or refs, is ever read by Althar's own git.
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
  /**
   * What the coordinator's commands may read, where a sandbox holds them
   * (ADR-058): none of `denied` (the home folder, the person's checkouts,
   * Althar's folders for the project's tasks) but what `allowed` gives back
   * (its folder, the mirrors, the objects its copies borrow, and the
   * toolchains a command runs on). Real paths, as a sandbox matches them.
   */
  readonly reads: { readonly allowed: ReadonlyArray<string>; readonly denied: ReadonlyArray<string> }
}

/**
 * Where programs a command runs on are kept in the home folder, which a
 * sandboxed command may read: bun, Node's version managers, Deno, Rust's,
 * Python's, and git's config file. Never a folder that holds a key: only
 * `~/.cargo/bin` of `~/.cargo`, whose credentials are beside it.
 */
export const TOOLCHAINS = [
  '.bun',
  '.nvm',
  '.volta',
  '.fnm',
  '.local/share/fnm',
  '.local/share/mise',
  '.asdf',
  '.deno',
  '.cargo/bin',
  '.rustup',
  '.pyenv',
  '.local/bin',
  '.gitconfig',
]

/**
 * Git's files in its config folder a command may read, named one by one:
 * never the folder, where git's credential store keeps passwords in plain
 * text (`credentials`).
 */
export const GIT_CONFIG_FILES = ['config', 'ignore', 'attributes']

/** A path as the filesystem has it, links followed, as far as it is there. */
const real = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(real(parent), basename(path))
  }
}

/**
 * What the coordinator's sandboxed commands may read (ADR-058): none of the
 * home folder, the project's task folders or the person's checkouts, but its
 * folder, the mirrors, the objects its copies borrow, the toolchains there
 * are and git's config files. Git's config folder is `$XDG_CONFIG_HOME/git`
 * where that is set, and its credential store there is denied wherever it is.
 */
export const readsOf = (place: {
  readonly home: string
  readonly xdgConfig?: string | undefined
  readonly projectFolder: string
  readonly folder: string
  readonly mirrors: string
  readonly objects: ReadonlyArray<string>
  readonly repositories: ReadonlyArray<string>
}) => {
  const gitConfig = join(place.xdgConfig === undefined || place.xdgConfig === '' ? join(place.home, '.config') : place.xdgConfig, 'git')
  const allowed = [
    place.folder,
    place.mirrors,
    ...place.objects,
    ...TOOLCHAINS.map((toolchain) => join(place.home, toolchain)).filter((toolchain) => existsSync(toolchain)),
    // Whether or not they are there: git reading one held from it fails rather than going without.
    ...GIT_CONFIG_FILES.map((file) => join(gitConfig, file)),
  ].map(real)
  const denied = [place.home, place.projectFolder, ...place.repositories, join(gitConfig, 'credentials')].map(real)
  return { allowed: [...new Set(allowed)], denied: [...new Set(denied)] }
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
 * The repository's record of the worktree a copy was made as before, where
 * the copy's git file names one that names the copy back: its folder in the
 * repository's `worktrees`. Any other it names, a task's worktree's or the
 * repository's own git folder, is none of the copy's.
 */
const formerWorktree = (common: string, path: string, dotGit: string): string | undefined => {
  if (kindOf(dotGit) !== 'file') return undefined
  const named = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
  if (named === undefined) return undefined
  const record = resolve(path, named)
  if (dirname(record) !== join(common, 'worktrees') || kindOf(join(record, 'gitdir')) !== 'file') return undefined
  const back = readFileSync(join(record, 'gitdir'), 'utf8').trim()
  return realpathSync(dirname(back)) === realpathSync(path) ? record : undefined
}

/**
 * A folder of its own at `path`, and no git folder in it: a link or a file
 * left there goes (only it, never what it points at), and so does the git
 * folder, whatever it is. One a worktree of the repository's left behind, as
 * copies were made before, is dropped from the repository's worktrees too,
 * and no other worktree's record is touched.
 */
const clearedFor = (repository: string, path: string) =>
  Effect.gen(function* () {
    const common = realpathSync(resolve(repository, yield* git(repository, 'rev-parse', '--git-common-dir')))
    if (kindOf(path) !== 'folder') rmSync(path, { force: true })
    mkdirSync(path, { recursive: true })
    const dotGit = join(path, '.git')
    const former = formerWorktree(common, path, dotGit)
    rmSync(dotGit, { recursive: true, force: true })
    if (former !== undefined) rmSync(former, { recursive: true, force: true })
  }).pipe(Effect.catchDefect((error) => Effect.fail(new GitFailed({ args: ['init'], cwd: path, stderr: String(error) }))))

/** The folder of the person's repository's objects, which a copy and its mirror borrow. */
const objectsOf = (repository: string) =>
  Effect.map(git(repository, 'rev-parse', '--git-path', 'objects'), (objects) => resolve(repository, objects))

/** Has a repository borrow `objects`, to read, rather than holding them. */
const borrow = (gitFolder: string, objects: string) =>
  Effect.try({
    try: () => {
      mkdirSync(join(gitFolder, 'objects', 'info'), { recursive: true })
      writeFileSync(join(gitFolder, 'objects', 'info', 'alternates'), `${objects}\n`)
    },
    catch: (error) => new GitFailed({ args: ['init'], cwd: gitFolder, stderr: String(error) }),
  })

/**
 * A bare mirror of `repository`'s refs at `path`, which a copy fetches from
 * rather than the person's checkout: made if it isn't there, borrowing the
 * repository's objects, and brought up to date with its branches, each
 * remote's and its tags. Only Althar writes it, out of the coordinator's
 * folder.
 */
export const freshMirror = (repository: string, path: string) =>
  Effect.gen(function* () {
    if (!existsSync(join(path, 'HEAD'))) {
      mkdirSync(path, { recursive: true })
      yield* git(path, 'init', '--quiet', '--bare', '--template=')
    }
    yield* borrow(path, yield* objectsOf(repository))
    yield* git(path, 'fetch', '--quiet', '--prune', repository, ...MIRRORED)
  })

/**
 * A copy of `repository` at `path`, detached at its default branch as the
 * remote has it, or offline as this computer has it: made if it isn't there, its
 * git folder made again, and anything written in it since thrown away, but
 * what git ignores, such as installed packages. Its fetch comes from `from`,
 * a mirror of the repository's (`freshMirror`), or the repository itself.
 */
export const freshCopy = (repository: string, path: string, base: string, from = repository) =>
  Effect.gen(function* () {
    // Every branch of the remote, so the copy's `git fetch` has them all as of this turn; offline, the repository as it is.
    const fetched = yield* gitWithin(60_000, repository, 'fetch', '--quiet', 'origin').pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    const remote = fetched ? yield* commitOf(repository, `origin/${base}`).pipe(Effect.option) : Option.none()
    const commit = Option.isSome(remote) ? remote.value : yield* commitOf(repository, base)
    const objects = yield* objectsOf(repository)
    if (from !== repository) yield* freshMirror(repository, from)
    yield* clearedFor(repository, path)
    // No template: no sample hooks, nothing but what git needs.
    yield* git(path, 'init', '--quiet', '--template=', ...(commit.length === 64 ? ['--object-format=sha256'] : []))
    yield* borrow(join(path, '.git'), objects)
    yield* git(path, 'config', 'remote.origin.url', from)
    for (const refspec of MIRRORED) yield* git(path, 'config', '--add', 'remote.origin.fetch', refspec)
    // A tag made in the copy isn't signed with the person's key, whatever their own config says.
    yield* git(path, 'config', 'tag.gpgSign', 'false')
    yield* git(path, 'config', 'commit.gpgSign', 'false')
    // Its unborn branch may be one it fetches.
    yield* git(path, 'fetch', '--quiet', '--update-head-ok', 'origin')
    yield* git(path, 'checkout', '--quiet', '--detach', '--force', commit)
    yield* git(path, 'clean', '-fdq')
  })

/** Where a project's coordinator folder is, by the project's slug: its copies are in it, each by its repository's. */
export const coordinatorFolderAt = (worktreeRoot: string, slug: string) => join(worktreeRoot, slug, '.coordinator')

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
    const projectFolder = join(config.worktreeRoot, project.slug)
    const folder = coordinatorFolderAt(config.worktreeRoot, project.slug)
    // Beside the coordinator's folder, never in it: what its commands may write is only that folder.
    const mirrors = join(projectFolder, '.coordinator-mirrors')
    mkdirSync(folder, { recursive: true })
    mkdirSync(mirrors, { recursive: true })
    const repositories = yield* Effect.forEach(bindings, (binding) =>
      Effect.gen(function* () {
        const base = binding.base ?? 'main'
        const path = join(folder, binding.slug)
        yield* freshCopy(binding.repository, path, base, join(mirrors, `${binding.slug}.git`))
        return {
          name: binding.name,
          path: binding.within === null ? path : join(path, binding.within),
          root: path,
          within: binding.within,
          base,
        }
      }),
    )
    const reads = readsOf({
      home: homedir(),
      xdgConfig: process.env.XDG_CONFIG_HOME,
      projectFolder,
      folder,
      mirrors,
      objects: yield* Effect.forEach(bindings, (binding) => objectsOf(binding.repository)),
      repositories: bindings.map((binding) => binding.repository),
    })
    return { folder, repositories, reads } satisfies CoordinatorFolder
  })
