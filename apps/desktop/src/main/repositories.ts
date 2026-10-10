import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'

/*
 * The git repositories on this computer where people usually keep code, for
 * the first screen to offer before there is a project: ~/Projects,
 * ~/Developer, ~/code and the like, and a folder or two down in each. Only
 * read: names, the branch checked out, and when each was last worked on.
 * On a Mac it never looks in Documents, Desktop or Downloads, which the
 * system guards with a prompt of its own; a folder added by hand reaches
 * those. A worktree is not offered on its own: its repository is.
 */

/** A repository found, as main hands it to the window. */
export interface FoundHere {
  /** Its root, under the place it was found in. */
  readonly path: string
  readonly name: string
  /** The branch checked out, or null where none is. */
  readonly branch: string | null
  /** When it was last worked on, as ms since the epoch: the latest of its HEAD, index and reflog. */
  readonly worked: number
}

export interface FoundRepositories {
  /** The places looked in that there are, as their paths. */
  readonly lookedIn: ReadonlyArray<string>
  /** Newest work first. */
  readonly repositories: ReadonlyArray<FoundHere>
}

/** The folders, under the home, where people keep code. */
const PLACES = [
  'Projects',
  'projects',
  'Developer',
  'Code',
  'code',
  'dev',
  'Dev',
  'src',
  'repos',
  'Repos',
  'git',
  'GitHub',
  'Work',
  'work',
  'workspace',
  'Sites',
]

/** Where to look on this system: the usual folders, and where Visual Studio and GitHub Desktop put repositories off a Mac. */
export const placesFor = (home: string, platform: NodeJS.Platform): ReadonlyArray<string> => [
  ...PLACES.map((place) => join(home, place)),
  ...(platform === 'darwin' ? [] : [join(home, 'source', 'repos'), join(home, 'Documents', 'GitHub')]),
]

/** How far it looks: a folder or two down from each place, and no more than so many folders in any one. */
const LOOK = { depth: 2, perFolder: 400, most: 40 } as const

/** Folders never looked through: the hidden, and what a build or package manager fills. */
const SKIPPED = new Set(['node_modules', 'vendor', 'target', 'build', 'dist', 'Library'])

/** The branch HEAD names, or null when it is detached or unreadable. */
const branchOf = async (git: string) => {
  const head = await readFile(join(git, 'HEAD'), 'utf8').catch(() => '')
  return /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim() ?? null
}

/** When the repository was last worked on: the newest of what git touches as it is used. */
const workedOn = async (git: string) => {
  const times = await Promise.all(
    ['HEAD', 'index', join('logs', 'HEAD')].map((file) =>
      stat(join(git, file)).then(
        (found) => found.mtimeMs,
        () => 0,
      ),
    ),
  )
  return Math.max(...times)
}

/** The repository at `dir`, where its `.git` is a folder of its own; a worktree's `.git` is a file, and is passed over. */
const repositoryAt = async (dir: string): Promise<FoundHere | null> => {
  const git = join(dir, '.git')
  const found = await lstat(git).catch(() => null)
  if (found?.isDirectory() !== true) return null
  return { path: dir, name: basename(dir), branch: await branchOf(git), worked: await workedOn(git) }
}

/** The folders in `dir` worth looking in, by path. */
const foldersIn = async (dir: string) => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name))
    .slice(0, LOOK.perFolder)
    .map((entry) => join(dir, entry.name))
}

/** The repositories at or under `dir`, `depth` folders down at most; one found isn't looked inside. */
const repositoriesUnder = async (dir: string, depth: number): Promise<ReadonlyArray<FoundHere>> => {
  const here = await repositoryAt(dir)
  if (here !== null) return [here]
  if (depth === 0) return []
  const found = await Promise.all((await foldersIn(dir)).map((folder) => repositoriesUnder(folder, depth - 1)))
  return found.flat()
}

/**
 * The repositories in the places given, newest work first, each once: a
 * place reached twice, as `Code` and `code` are on a Mac's disk, is looked
 * in once.
 */
export const findRepositories = async (places: ReadonlyArray<string>): Promise<FoundRepositories> => {
  const real = await Promise.all(
    places.map(async (place) => {
      const found = await stat(place).catch(() => null)
      return found?.isDirectory() === true ? { place, real: await realpath(place) } : null
    }),
  )
  const seen = new Set<string>()
  const lookedIn: Array<string> = []
  for (const each of real) {
    if (each === null || seen.has(each.real)) continue
    seen.add(each.real)
    // On a disk that ignores case, `Code` finds `code`: it is named as it is on disk.
    const named = basename(each.real)
    lookedIn.push(named.toLowerCase() === basename(each.place).toLowerCase() ? join(dirname(each.place), named) : each.place)
  }
  const found = (await Promise.all(lookedIn.map((place) => repositoriesUnder(place, LOOK.depth)))).flat()
  const once = new Map<string, FoundHere>()
  for (const repository of found) {
    const root = await realpath(repository.path).catch(() => repository.path)
    if (!once.has(root)) once.set(root, repository)
  }
  return { lookedIn, repositories: [...once.values()].sort((a, b) => b.worked - a.worked).slice(0, LOOK.most) }
}

/** A place as the person knows it: under their home, from ~. */
export const shownAt = (path: string, home: string) =>
  path === home ? '~' : path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path

/**
 * The repositories found, as the window gets them: each by an id main
 * grants it by, and where it is as the person knows the place, never by its
 * path. `idOf` keeps which path an id stands for.
 */
export const forWindow = (found: FoundRepositories, home: string, idOf: (path: string) => string) => ({
  lookedIn: found.lookedIn.map((place) => shownAt(place, home)),
  repositories: found.repositories.map((repository) => ({
    id: idOf(repository.path),
    name: repository.name,
    where: shownAt(repository.path, home),
    branch: repository.branch,
    worked: repository.worked,
  })),
})
