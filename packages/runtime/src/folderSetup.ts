import { existsSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse } from 'node:path'

import { cleanUp } from '@althar/provider-adapters'
import { Effect, Option } from 'effect'

import { CloneRefused, FolderRefused, type GitFailed } from './errors'
import { cloneInto, commitFirst, commitOf, currentBranch, git, topLevel } from './git'

/*
 * A folder made ready to be a project's repository, as the project is made:
 * one that isn't a repository gets git, on main, with what is in it as its
 * first commit; one that is, with no commit yet, gets its first. A task
 * branches from a commit, so a project's repository needs one. A folder too
 * wide to be one project, the home folder or the disk's root, is refused,
 * as is one with more files than a repository starts with, or with
 * repositories inside it, which git would take in as empty links. What
 * this made is taken away again where it fails, so the folder is as it was.
 *
 * And a repository cloned onto this computer from its host, into a folder
 * of its name in the one the person chose: refused where that folder has
 * something in it already, and taken away again where the clone fails.
 */

/** As many files as a folder's first commit takes: more is a folder of folders, or of things built, not a project's code. */
export const MOST_FILES = 20_000

/**
 * What a new repository ignores where the folder has no .gitignore of its
 * own: the system's litter, dependencies installed, and the files secrets
 * are kept in, which must never reach a host.
 */
export const IGNORED = ['.DS_Store', 'node_modules/', '.venv/', '__pycache__/', '.env', '.env.*', '!.env.example', ''].join('\n')

/** What making a folder ready did: started git, made its first commit, or nothing, it had one; and on which branch. */
export interface Prepared {
  readonly did: 'started' | 'committed' | 'nothing'
  /** The repository's root. */
  readonly path: string
  readonly branch: string
  /** The files its first commit has, where this made one. */
  readonly files: number
}

const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Whether `path` is too wide to be a project: the disk's root, the home folder, or a folder the home folder is in. */
const tooWide = (path: string) => {
  const home = real(homedir())
  return path === parse(path).root || path === home || home.startsWith(`${path}/`)
}

/** What is staged, as git lists it: each file's mode and path. */
const staged = (path: string) =>
  git(path, 'ls-files', '--stage', '-z').pipe(
    Effect.map((listed) =>
      listed
        .split('\0')
        .filter((line) => line !== '')
        .map((line) => ({ mode: line.slice(0, 6), path: line.slice(line.indexOf('\t') + 1) })),
    ),
  )

/** Stages everything in the folder git doesn't ignore, then its first commit, refused where what's staged is too much or holds repositories. */
const commitWhatIsThere = (path: string, most: number) =>
  Effect.gen(function* () {
    // A repository inside with no commit yet git won't stage at all, and names it.
    yield* git(path, 'add', '--all').pipe(
      Effect.catchIf(
        (failed) => /does not have a commit checked out/.test(failed.stderr),
        (failed) =>
          Effect.fail(
            new FolderRefused({
              reason: 'repositories_inside',
              path,
              names: [...failed.stderr.matchAll(/'([^']+?)\/?' does not have a commit checked out/g)].flatMap((found) => found[1] ?? []),
            }),
          ),
      ),
    )
    const files = yield* staged(path)
    // A folder with a .git of its own, staged as an empty link: its files would be in no commit.
    const inside = files.filter((file) => file.mode === '160000').map((file) => file.path)
    if (inside.length > 0) return yield* new FolderRefused({ reason: 'repositories_inside', path, names: inside })
    if (files.length > most) return yield* new FolderRefused({ reason: 'too_many', path, count: files.length })
    yield* commitFirst(path)
    return files.length
  })

/**
 * Makes the folder at `path` ready to be a project's repository: git, and a
 * first commit, where it hasn't them. A folder inside a repository is that
 * repository's, ready or not, and is left as it is.
 */
export const prepareFolder = (opened: string, most = MOST_FILES): Effect.Effect<Prepared, FolderRefused | GitFailed> =>
  Effect.gen(function* () {
    const path = real(opened)
    const listed = yield* Effect.try({
      try: () => readdirSync(path),
      catch: () => new FolderRefused({ reason: 'unreadable', path }),
    })
    const root = yield* topLevel(path).pipe(
      Effect.map(real),
      Effect.orElseSucceed(() => null),
    )
    if (root !== null) {
      const branch = (yield* currentBranch(root)) ?? 'main'
      if (root !== path || Option.isSome(yield* commitOf(root, 'HEAD').pipe(Effect.option))) return { did: 'nothing', path: root, branch, files: 0 }
      // A repository with no commit yet: what's in it is its first, on the branch it is on.
      const files = yield* commitWhatIsThere(root, most).pipe(Effect.tapError(() => Effect.ignore(git(root, 'reset', '--quiet'))))
      return { did: 'committed', path: root, branch, files }
    }
    if (tooWide(path)) return yield* new FolderRefused({ reason: 'too_wide', path })
    const ignore = join(path, '.gitignore')
    const ignoring = !listed.includes('.gitignore')
    const undo = Effect.gen(function* () {
      yield* cleanUp(join(path, '.git'), 'where git couldn’t be started')
      if (ignoring) yield* cleanUp(ignore, 'where git couldn’t be started')
    })
    return yield* Effect.gen(function* () {
      yield* git(path, 'init', '--quiet', '--initial-branch=main')
      if (ignoring)
        yield* Effect.try({
          try: () => writeFileSync(ignore, IGNORED, { flag: 'wx' }),
          catch: () => new FolderRefused({ reason: 'unreadable', path }),
        })
      const files = yield* commitWhatIsThere(path, most)
      return { did: 'started' as const, path, branch: 'main', files }
    }).pipe(Effect.onError(() => undo))
  })

/** What is in a folder, or nothing where it can't be read. */
const readdirSafe = (path: string) => {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/** Whether `path` holds nothing: no folder, or an empty one. */
const free = (path: string) => {
  if (!existsSync(path)) return true
  try {
    return readdirSync(path).length === 0
  } catch {
    return false
  }
}

/** The folder a repository's clone goes in: its name, as its host names it, the last part of its path. */
export const cloneFolderOf = (path: ReadonlyArray<string>) => (path.at(-1) ?? '').replace(/\.git$/, '')

/** Reads git's words for why a clone failed: which of CloneRefused's reasons, and where the person can sign in, for single sign-on. */
export const whyCloneFailed = (stderr: string): { readonly reason: 'sso' | 'not_found' | 'failed'; readonly url?: string } => {
  if (/SAML|single sign-on|SSO/i.test(stderr)) {
    const url = /https:\/\/\S+\/sso\S*/.exec(stderr)?.[0]
    return url === undefined ? { reason: 'sso' } : { reason: 'sso', url }
  }
  if (/not found|does not exist|could not be found|Repository not found|404/i.test(stderr)) return { reason: 'not_found' }
  return { reason: 'failed' }
}

/**
 * Clones a repository into a folder of its name in `parent`, the folder
 * made where it isn't there: its path. An empty folder of that name is used
 * as it is; one with something in it is refused, as it may be someone's
 * work. What this made is taken away again where the clone fails, or is
 * stopped, so trying again finds the place free.
 */
export const cloneRepository = (input: {
  readonly parent: string
  /** As its host names it, to say which: northwind/app. */
  readonly remote: string
  readonly host: string
  readonly folder: string
  readonly target: { readonly url: string; readonly header: string | null }
}): Effect.Effect<string, FolderRefused | CloneRefused> =>
  Effect.gen(function* () {
    const parent = real(input.parent)
    const path = join(parent, input.folder)
    if (input.folder === '' || input.folder === '.' || input.folder === '..' || dirname(path) !== parent)
      return yield* new FolderRefused({ reason: 'taken', path })
    if (!free(path)) return yield* new FolderRefused({ reason: 'taken', path })
    // git clones into an empty folder as well as making one; what it left where it failed goes, the empty folder staying.
    const there = existsSync(path)
    const undo = there
      ? Effect.forEach(readdirSafe(path), (entry) => cleanUp(join(path, entry), 'where a clone failed'), { discard: true })
      : cleanUp(path, 'where a clone failed')
    yield* cloneInto(parent, input.folder, input.target).pipe(
      Effect.mapError((failed) => {
        const why = whyCloneFailed(failed.stderr)
        return new CloneRefused({
          ...why,
          remote: input.remote,
          host: input.host,
          ...(why.reason === 'failed' ? { detail: failed.timedOut === true ? 'It took too long.' : failed.stderr } : {}),
        })
      }),
      Effect.onError(() => undo),
    )
    return real(path)
  })
