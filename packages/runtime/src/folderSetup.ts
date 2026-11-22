import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, sep } from 'node:path'

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
 * repositories inside it, which git would take in as empty links, or with a
 * .git git can't read. What this made is taken away again where it fails,
 * so the folder is as it was; what was there before never is. What holds
 * secrets stays out of a first commit made here.
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

/**
 * Files that hold secrets, kept out of a first commit Althar makes whatever
 * the folder's own ignore rules say, as a first commit may go to a host as
 * the project is made: .env and its kin (not an example of it), keys and
 * certificates. They stay in the folder, untracked.
 */
export const SECRET = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]+)?|[^/]+\.(?:pem|key|p12|pfx)|id_(?:rsa|dsa|ecdsa|ed25519))$/

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
  // By the system's separator: on Windows a folder the home is in is `C:\Users`, followed by a backslash.
  return path === parse(path).root || path === home || home.startsWith(path.endsWith(sep) ? path : `${path}${sep}`)
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
    const all = yield* staged(path)
    // What holds secrets never goes in by itself: taken out of what's staged, each by its literal path.
    const secrets = all.filter((file) => SECRET.test(file.path)).map((file) => `:(literal)${file.path}`)
    if (secrets.length > 0) yield* git(path, 'rm', '--cached', '--quiet', '--', ...secrets)
    const files = all.filter((file) => !SECRET.test(file.path))
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
    // Not a repository, as git says; any other failure is said as it is, never taken for none.
    const root = yield* topLevel(path).pipe(
      Effect.map(real),
      Effect.catchIf(
        (failed) => /not a git repository/i.test(failed.stderr),
        () => Effect.succeed(null),
      ),
    )
    if (root !== null) {
      const branch = (yield* currentBranch(root)) ?? 'main'
      if (root !== path || Option.isSome(yield* commitOf(root, 'HEAD').pipe(Effect.option)))
        return { did: 'nothing', path: root, branch, files: 0 }
      // A repository with no commit yet: what's in it is its first, on the branch it is on.
      const files = yield* commitWhatIsThere(root, most).pipe(Effect.tapError(() => Effect.ignore(git(root, 'reset', '--quiet'))))
      return { did: 'committed', path: root, branch, files }
    }
    if (tooWide(path)) return yield* new FolderRefused({ reason: 'too_wide', path })
    // A .git git can't read is someone's repository, damaged: refused, and never started over or taken away.
    if (listed.includes('.git')) return yield* new FolderRefused({ reason: 'broken_repository', path })
    const ignore = join(path, '.gitignore')
    const ignoring = !listed.includes('.gitignore')
    // Only what this made goes again: the .git, not there before, and the .gitignore where it wrote one.
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
 * Clones a repository into a folder of its name in `parent`, each folder
 * made where it isn't there: its path. An empty folder of that name is used
 * as it is; one with something in it is refused, as it may be someone's
 * work. git clones into a hidden folder of this clone's own beside it, moved
 * into place once it's whole, and only where that is still free: two clones
 * of one name at once never meet, and the one that finds the place taken
 * takes away only its own. Where the clone fails, or is stopped, what it made
 * goes, so trying again finds the place free.
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
    // The place itself is made where it isn't there yet, as a home's first place for projects is.
    yield* Effect.sync(() => mkdirSync(parent, { recursive: true }))
    // This clone's own, hidden as the finder passes it over, on the same disk so it moves into place whole.
    const staging = `.${input.folder}.cloning-${randomBytes(6).toString('hex')}`
    yield* Effect.acquireUseRelease(
      Effect.succeed(join(parent, staging)),
      () =>
        Effect.gen(function* () {
          yield* cloneInto(parent, staging, input.target).pipe(
            Effect.mapError((failed) => {
              const why = whyCloneFailed(failed.stderr)
              return new CloneRefused({
                ...why,
                remote: input.remote,
                host: input.host,
                ...(why.reason === 'failed' ? { detail: failed.timedOut === true ? 'It took too long.' : failed.stderr } : {}),
              })
            }),
          )
          yield* Effect.try({
            try: () => settleInto(join(parent, staging), path),
            catch: () => new FolderRefused({ reason: 'taken', path }),
          })
        }),
      // Gone once it's in place; what's left of it where it isn't goes.
      (left) => (existsSync(left) ? cleanUp(left, 'where a clone failed') : Effect.void),
    )
    return real(path)
  })

/**
 * Moves a whole clone to `path`, where that is free: not there, or an empty
 * folder, which goes (only an empty one can). Refused where something is in
 * it by now, another clone of the same name say, which stays as it is.
 */
const settleInto = (from: string, path: string) => {
  try {
    // oxlint-disable-next-line althar/one-removal -- Only an empty folder may go: removing more would take what another clone just put there.
    rmdirSync(path)
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure
  }
  // Where a folder of the name was made since, the move is refused rather than putting this one in it.
  renameSync(from, path)
}
