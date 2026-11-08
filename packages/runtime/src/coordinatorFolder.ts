import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

import { removeFully, SECRET_PLACES } from '@althar/provider-adapters'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { GitFailed, NotFound } from './errors'
import { commitOf, git, gitWithin } from './git'
import { Instance } from './Instance'
import { TOOLCHAINS } from './locations'
import { startOf } from './Projects'

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
   * Secret paths its sandbox and read tools deny. Ordinary files are readable
   * anywhere (ADR-097); writes remain held to the coordinator's own folder.
   */
  readonly reads: { readonly allowed: ReadonlyArray<string>; readonly denied: ReadonlyArray<string> }
}

/**
 * Where programs a command runs on are kept in the home folder, which a
 * sandboxed command may read: bun, Node's version managers, Deno, Rust's,
 * Python's, and git's config file. Never a folder that holds a key: only
 * `~/.cargo/bin` of `~/.cargo`, whose credentials are beside it.
 */
export { TOOLCHAINS }

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
 * Secret paths denied to coordinator commands and read tools. Include git's
 * credential store at its actual XDG location as well as the shared list.
 */
export const readsOf = (place: {
  readonly home: string
  readonly xdgConfig?: string | undefined
  /** Where every project's task folders are made now (ADR-058: the coordinator reads none of them, other projects' included). */
  readonly root: string
  readonly folder: string
  readonly mirrors: string
  readonly objects: ReadonlyArray<string>
  readonly repositories: ReadonlyArray<string>
  /** The roots task folders were made in before the person moved it (Settings can): what is in them stays where it is, and stays denied. */
  readonly earlier?: ReadonlyArray<string>
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
  const taskFolders = [place.root, ...(place.earlier ?? [])].map(real)
  const denied = [...SECRET_PLACES.map((secret) => join(place.home, secret)), ...taskFolders, join(gitConfig, 'credentials')].map(real)
  // A place that holds task folders is not given back whole: a task root chosen in Settings may sit in a toolchain's folder (~/.bun), and
  // the broader allowance would otherwise override the denial of the task folders in it.
  const holdsTaskFolder = (path: string) => taskFolders.some((folder) => folder === path || folder.startsWith(path + sep))
  return { allowed: [...new Set(allowed.filter((path) => !holdsTaskFolder(path)))], denied: [...new Set(denied)] }
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
    // A link or a file alone, never recursively, so nothing it points at goes; clearing the place is the work, which fails if it can't.
    // oxlint-disable-next-line althar/one-removal
    if (kindOf(path) !== 'folder') rmSync(path, { force: true })
    mkdirSync(path, { recursive: true })
    const dotGit = join(path, '.git')
    const former = formerWorktree(common, path, dotGit)
    const cleared = (gone: string) =>
      removeFully(gone).pipe(Effect.mapError((failed) => new GitFailed({ args: ['init'], cwd: path, stderr: failed.reason })))
    yield* cleared(dotGit)
    if (former !== undefined) yield* cleared(former)
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
 * A copy of `repository` at `path`, detached at `base` as `remote` has it
 * (the remote its tasks start from: a fork's upstream, where its work goes
 * there), or offline as this computer has it: made if it isn't there, its
 * git folder made again, and anything written in it since thrown away, but
 * what git ignores, such as installed packages. Its fetch comes from `from`,
 * a mirror of the repository's (`freshMirror`), or the repository itself.
 * The coordinator answers only once its copies are made, so the remote gets
 * `within` milliseconds: one slow or asking for a host key costs that, and
 * the copy is made from the last fetch.
 */
export const freshCopy = (repository: string, path: string, base: string, from = repository, remote = 'origin', within = 15_000) =>
  Effect.gen(function* () {
    // Every branch of the remote, so the copy's `git fetch` has them all as of this turn; offline, the repository as it is.
    const fetched = yield* gitWithin(within, repository, 'fetch', '--quiet', remote).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    const there = (ref: string) => commitOf(repository, ref).pipe(Effect.option)
    const fresh = fetched ? yield* there(`refs/remotes/${remote}/${base}`) : Option.none()
    // Offline, the branch here, else the remote's as last fetched: one only upstream has no branch here until a task makes it.
    const commit = Option.isSome(fresh)
      ? fresh.value
      : yield* commitOf(repository, `refs/heads/${base}`).pipe(Effect.catch(() => commitOf(repository, `refs/remotes/${remote}/${base}`)))
    yield* copyAt(repository, path, commit, from)
  })

/**
 * A copy of `repository` at `path`, detached at `commit`, as `freshCopy`
 * makes one: its git folder made again, borrowing the repository's objects,
 * and anything written in it since thrown away, but what git ignores.
 */
export const copyAt = (repository: string, path: string, commit: string, from = repository) =>
  Effect.gen(function* () {
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
    const bindings = yield* sql<{
      slug: string
      name: string
      base: string | null
      changeTarget: string | null
      workToward: string | null
      within: string | null
      repository: string
    }>`
      SELECT b.slug, b.display_name AS name, b.default_base_ref AS base, b.change_target, b.work_toward, b.folder AS within,
        l.path AS repository
      FROM repository_bindings b
      JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
      ORDER BY b.created_at, b.rowid`
    const projectFolder = join(config.worktreeRoot, project.slug)
    // Task folders made under another root, before the person moved it (Settings › Task folders), are still there.
    const earlier = earlierRoots(
      (yield* sql<{ path: string }>`
        SELECT path FROM workspaces WHERE project_id = ${projectId} AND device_id = ${instance.deviceId} AND kind IS NULL`).map(
        (workspace) => workspace.path,
      ),
      config.worktreeRoot,
      homedir(),
    )
    const folder = coordinatorFolderAt(config.worktreeRoot, project.slug)
    // Beside the coordinator's folder, never in it: what its commands may write is only that folder.
    const mirrors = join(projectFolder, '.coordinator-mirrors')
    mkdirSync(folder, { recursive: true })
    mkdirSync(mirrors, { recursive: true })
    const repositories = yield* Effect.forEach(bindings, (binding) =>
      Effect.gen(function* () {
        // Where its tasks start (ADR-093): the branch the project works toward, on a fork's upstream where its work goes there.
        const { remote, base } = yield* startOf({ ...binding, toward: binding.workToward })
        const path = join(folder, binding.slug)
        yield* freshCopy(binding.repository, path, base, join(mirrors, `${binding.slug}.git`), remote)
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
      root: config.worktreeRoot,
      earlier,
      folder,
      mirrors,
      objects: yield* Effect.forEach(bindings, (binding) => objectsOf(binding.repository)),
      repositories: bindings.map((binding) => binding.repository),
    })
    return { folder, repositories, reads } satisfies CoordinatorFolder
  })

/**
 * The earlier roots task folders were made in, from the paths of the project's worktrees (root/project/task/repository). The person's own
 * checkouts (kind 'checkout') aren't asked for. A root that is a filesystem or drive root, or home or holds it, is skipped (it would deny
 * everything), as is the current root and what is in it.
 */
export const earlierRoots = (worktrees: ReadonlyArray<string>, root: string, home: string): ReadonlyArray<string> => {
  const roots = worktrees.map((path) => dirname(dirname(dirname(path)))).filter((path) => dirname(path) !== path)
  return [...new Set(roots)].filter(
    (path) => path !== home && !home.startsWith(path + sep) && path !== root && !path.startsWith(root + sep),
  )
}
