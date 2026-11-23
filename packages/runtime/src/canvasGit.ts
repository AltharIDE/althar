import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { ConnectorFailed } from '@althar/connectors'
import { cleanUp } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { type CopyFile, writeCopy } from './canvasFiles'
import type { Connections } from './Connections'
import { GitFailed } from './errors'
import { committerIdentity } from './commitIdentity'
import { addDetachedWorktree, defaultBranch, git, gitOutcome, gitWith, gitWithInput } from './git'
import { ToolRefused } from './ToolServer'

export const refuse = (message: string) => new ToolRefused({ message })

// A project can be used on another OS. Refuse paths that git or the filesystem
// could read as their own metadata, a different file, or an address outside the worktree.
const reserved = /^(?:\.\.?|\.git|git~[1-9]\d*|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:$|\.)/iu
const invalid = /[\\:*?"<>|\p{Cc}\p{Cf}]/u
export const safePath = (path: string) =>
  path.split('/').every((part) => part !== '' && !invalid.test(part) && !/[. ]$/.test(part) && !reserved.test(part))

export const folderPath = (asked: string) => asked.replace(/\/$/, '')

export const problemIn = (name: string, branch: string, step: string, failed: unknown) => {
  if (failed instanceof ToolRefused) return failed.message
  if (failed instanceof ConnectorFailed && failed.reason === 'unauthorized') return `Sign in to ${name}’s code host again, then try saving.`
  if (failed instanceof GitFailed) {
    if (
      step === 'push' &&
      /protected branch|branch protection|GH006|required.*pull request|changes must be made through a pull request/i.test(failed.stderr)
    )
      return `${name}’s ${branch} is protected. Save it in a pull request instead.`
    if (/authentication failed|access denied|could not read (?:username|password)|permission denied \(publickey\)/i.test(failed.stderr))
      return `Couldn’t ${step} to ${name}. Check your git sign-in and try again.`
    if (step === 'push' && /non-fast-forward|fetch first|stale info/i.test(failed.stderr))
      return `${name}’s ${branch} changed while Althar was saving. Try again.`
    if (step === 'push' && /remote rejected|pre-receive hook declined|not permitted|permission denied/i.test(failed.stderr))
      return `${name} refused the push to ${branch}. Check the branch’s rules and your write access, then try again.`
  }
  const where = step === 'fetch' ? 'from' : step === 'push' || step === 'connect' ? 'to' : 'in'
  return `Couldn’t ${step} ${where} ${name}. Check that the repository is reachable and you can write to it, then try again.`
}

const speaksFor = (step: string, name: string, branch: string) =>
  Effect.mapError((failed: GitFailed | ConnectorFailed) => refuse(problemIn(name, branch, step, failed)))

const absoluteRemote = (checkout: string, url: string) => (isAbsolute(url) || url.includes(':') ? url : resolve(checkout, url))

export const remoteForSave = (connections: typeof Connections.Service, checkout: string, name: string, how: 'pr' | 'main') =>
  Effect.gen(function* () {
    const origin = yield* git(checkout, 'remote', 'get-url', 'origin').pipe(
      Effect.mapError(() => refuse(`Add an origin remote to ${name} on this device, then try saving again.`)),
    )
    const found = yield* connections.hostOf([origin], { fromCli: true })
    if (found !== null) {
      const { host } = found
      const repository = yield* host.repository(found.path).pipe(speaksFor('connect', name, ''))
      const target = yield* host.pushTarget(repository).pipe(speaksFor('connect', name, repository.defaultBranch))
      return { branch: repository.defaultBranch, fetch: target, target, hosted: { host, repository } }
    }
    if (how === 'pr') return yield* refuse(`Connect ${name}’s code host in Settings, then try saving in a pull request again.`)
    const url = yield* git(checkout, 'remote', 'get-url', '--push', 'origin').pipe(speaksFor('connect', name, ''))
    return {
      branch: yield* defaultBranch(checkout),
      fetch: { url: absoluteRemote(checkout, origin), header: null },
      target: { url: absoluteRemote(checkout, url), header: null },
      hosted: null,
    }
  })

export const withCanvasWorktree = <A, E, R>(
  checkout: string,
  worktreeRoot: string,
  base: string,
  use: (worktree: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        await mkdir(worktreeRoot, { recursive: true })
        return mkdtemp(join(worktreeRoot, '.canvas-save-'))
      },
      catch: () => refuse('Althar couldn’t make a temporary folder. Check disk space and try again.'),
    }),
    (temp) => {
      const worktree = join(temp, 'repo')
      return addDetachedWorktree(checkout, worktree, base).pipe(Effect.andThen(use(worktree)))
    },
    (temp) =>
      Effect.gen(function* () {
        const worktree = join(temp, 'repo')
        const removed = yield* gitOutcome(checkout, 'worktree', 'remove', '--force', '--force', worktree)
        yield* cleanUp(temp, 'a temporary canvas worktree')
        if (removed.code !== 0) yield* Effect.ignore(git(checkout, 'worktree', 'remove', '--force', '--force', worktree))
      }),
  )

const checkedFolder = (worktree: string, path: string) =>
  Effect.tryPromise({
    try: async () => {
      let parent = worktree
      for (const part of path.split('/').slice(0, -1)) {
        parent = join(parent, part)
        const info = await lstat(parent).catch((failed: NodeJS.ErrnoException) => {
          if (failed.code === 'ENOENT') return null
          throw failed
        })
        if (info === null) break
        if (!info.isDirectory() || info.isSymbolicLink()) return null
      }
      return join(worktree, ...path.split('/'))
    },
    catch: () => refuse(`Althar couldn’t read the folders for ${path}. Pick another folder or try again.`),
  }).pipe(
    Effect.flatMap((folder) =>
      folder === null ? Effect.fail(refuse(`A parent of ${path} is a link or a file. Pick another folder.`)) : Effect.succeed(folder),
    ),
  )

/**
 * A commit's entries under a folder, by their paths inside it, each as git has it: its mode, its type and its object
 * (`100644 blob …`). Every kind counts: a submodule (`160000 commit …`) or a link is someone's as much as a file is.
 */
const filesUnder = (worktree: string, rev: string, path: string) =>
  Effect.map(git(worktree, 'ls-tree', '-r', '-z', rev, '--', `${path}/`), (listed) => {
    const files = new Map<string, string>()
    for (const entry of listed.split('\0')) {
      const tab = entry.indexOf('\t')
      if (tab === -1) continue
      const file = entry.slice(tab + 1)
      if (file.startsWith(`${path}/`)) files.set(file.slice(path.length + 1), entry.slice(0, tab))
    }
    return files
  })

/** The entry a canvas's file is staged as: always a plain file, never executable. */
const entryOf = (format: string, bytes: Uint8Array) => `100644 blob ${blobOf(format, bytes)}`

/**
 * The incoming paths that would land on a file in git that isn't the canvas's own, or that would turn a folder of theirs
 * into a file or a file of theirs into a folder.
 */
const overTheirs = (incoming: ReadonlyArray<string>, theirs: ReadonlyArray<string>) => {
  const files = new Set(theirs)
  const folders = new Set(
    theirs.flatMap((name) =>
      name
        .split('/')
        .slice(0, -1)
        .map((_, i, parts) => parts.slice(0, i + 1).join('/')),
    ),
  )
  return incoming.filter((name) => {
    if (files.has(name) || folders.has(name)) return true
    const parts = name.split('/')
    return parts.slice(0, -1).some((_, i) => files.has(parts.slice(0, i + 1).join('/')))
  })
}

/** The blob git would keep for these bytes, unfiltered, in the repository's own hash. */
const blobOf = (format: string, bytes: Uint8Array) =>
  createHash(format === 'sha256' ? 'sha256' : 'sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex')

/**
 * Stages the canvas's files at `path`, with the store's bytes even where git would apply a filter, touching nothing it
 * didn't write itself. A first save, and a move, need a folder that holds nothing yet. A save after that replaces and
 * removes only the files its last save wrote (`previous`: that version's files, where it put them), as long as no one
 * changed them since; files others added beside them stay. Where someone changed one of its files, or a new file of its
 * would land on one someone else added, it refuses rather than overwrite or delete their work.
 */
export const stageCanvas = (
  worktree: string,
  path: string,
  previous: { readonly path: string; readonly files: ReadonlyArray<CopyFile> } | null,
  files: ReadonlyArray<CopyFile>,
) =>
  Effect.gen(function* () {
    if (!safePath(path) || (previous !== null && !safePath(previous.path)) || files.some((file) => !safePath(file.path)))
      return yield* refuse('A file or folder name can’t be saved safely in git. Rename it and try again.')
    const folder = yield* checkedFolder(worktree, path)
    const moved = previous !== null && previous.path !== path
    const here = yield* filesUnder(worktree, 'HEAD', path)
    if ((previous === null || moved) && here.size > 0)
      return yield* refuse(`${path}/ already holds files in git. Pick a folder of its own for this artifact, or move those files first.`)
    const removed: Array<string> = []
    if (previous !== null) {
      const format = yield* git(worktree, 'rev-parse', '--show-object-format')
      // Its own entries as it staged them: someone changing one's bytes, its mode or its kind changed it.
      const owned = new Map(previous.files.map((file) => [file.path, entryOf(format, file.bytes)]))
      const there = moved ? yield* filesUnder(worktree, 'HEAD', previous.path) : here
      const changed = [...owned].filter(([name, entry]) => there.has(name) && there.get(name) !== entry).map(([name]) => name)
      if (changed.length > 0)
        return yield* refuse(
          `Someone changed ${changed.map((name) => `${previous.path}/${name}`).join(', ')} in git since Althar last saved it. Bring those changes into the artifact or move them aside, then save again.`,
        )
      // Every path this version writes, its old ones and its new, lands only on what is its own: never on what others put there.
      const theirs = [...here.keys()].filter((name) => !owned.has(name))
      const over = overTheirs(
        files.map((file) => file.path),
        theirs,
      )
      if (over.length > 0)
        return yield* refuse(
          `This version would write over ${over.map((name) => `${path}/${name}`).join(', ')}, which someone else put in git. Rename ${over.length === 1 ? 'it' : 'them'} in the artifact, or move theirs aside, then save again.`,
        )
      const kept = new Set(files.map((file) => file.path))
      for (const name of owned.keys()) if (there.has(name) && (moved || !kept.has(name))) removed.push(`${previous.path}/${name}`)
    }
    if (removed.length > 0) yield* git(worktree, '--literal-pathspecs', 'rm', '-q', '-f', '--cached', '--ignore-unmatch', '--', ...removed)
    yield* writeCopy(folder, files).pipe(
      Effect.catchCause((cause) =>
        Effect.andThen(
          Effect.logDebug('Could not copy canvas files to its worktree', cause),
          Effect.fail(refuse(`Couldn’t write the canvas’s files in ${path}. Check disk space and try again.`)),
        ),
      ),
    )
    const paths = files.map((file) => `${path}/${file.path}`)
    const objects = (yield* gitWithInput(worktree, `${paths.join('\n')}\n`, 'hash-object', '-w', '--stdin-paths', '--no-filters'))
      .trimEnd()
      .split('\n')
    if (paths.length !== objects.length) return yield* refuse('Git couldn’t keep all of the canvas’s files. Try again.')
    const index = paths.map((file, i) => `100644 ${objects[i]}\t${file}\0`).join('')
    yield* gitWithInput(worktree, index, 'update-index', '-z', '--index-info')
  })

export const commitCanvas = (worktree: string, message: string) =>
  Effect.gen(function* () {
    yield* gitWith((yield* committerIdentity(worktree)).as, worktree, 'commit', '--allow-empty', '-q', '-m', message)
    return yield* git(worktree, 'rev-parse', 'HEAD')
  })
