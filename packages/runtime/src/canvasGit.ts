import { lstat, mkdir, mkdtemp } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { ConnectorFailed } from '@althar/connectors'
import { cleanUp } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { type CopyFile, writeCopy } from './canvasFiles'
import type { Connections } from './Connections'
import { GitFailed } from './errors'
import { addDetachedWorktree, committerIn, defaultBranch, git, gitOutcome, gitWithInput } from './git'
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

/** Mirrors just the canvas's folders, with the store's bytes even where git would apply a filter. */
export const stageCanvas = (worktree: string, path: string, oldPath: string | null, files: ReadonlyArray<CopyFile>) =>
  Effect.gen(function* () {
    if (!safePath(path) || (oldPath !== null && !safePath(oldPath)) || files.some((file) => !safePath(file.path)))
      return yield* refuse('A file or folder name can’t be saved safely in git. Rename it and try again.')
    const folder = yield* checkedFolder(worktree, path)
    yield* git(
      worktree,
      '--literal-pathspecs',
      'rm',
      '-r',
      '-f',
      '--cached',
      '--ignore-unmatch',
      '--',
      path,
      ...(oldPath === null ? [] : [oldPath]),
    )
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
    yield* git(worktree, ...(yield* committerIn(worktree)), 'commit', '--allow-empty', '-q', '-m', message)
    return yield* git(worktree, 'rev-parse', 'HEAD')
  })
