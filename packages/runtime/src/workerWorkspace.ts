import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanUp } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { GitFailed } from './errors'
import { commitTree, git, treeOf } from './git'

const SNAPSHOT_REF = 'refs/althar/worker-snapshot'
const COMMITS_REF = 'refs/althar/worker-head'

const failed = (cwd: string, args: ReadonlyArray<string>, reason: string) => new GitFailed({ cwd, args, reason, stderr: '' })

/**
 * Build a portable Git view of one task worktree. The synthetic commit has
 * the current HEAD as its parent and carries tracked and unignored changes.
 * A private bare repository gives it a bundle ref without changing any of
 * the task's own refs, index, configuration or working files.
 */
export const prepareWorkerWorkspace = (worktree: string, maxBytes: number) => {
  const failed = (reason: string) =>
    new GitFailed({
      args: ['bundle', 'create'],
      reason,
      cwd: worktree,
      stderr: '',
    })
  const io = <A>(run: () => Promise<A>, message: string) => Effect.tryPromise({ try: run, catch: () => failed(message) })
  const folder = Effect.acquireRelease(
    io(() => mkdtemp(join(tmpdir(), 'althar-worker-bundle-')), 'Could not create a private workspace transfer folder.'),
    (path) => cleanUp(path, 'the prepared worker workspace'),
  )
  return Effect.gen(function* () {
    const head = yield* git(worktree, 'rev-parse', '--verify', 'HEAD')
    const tree = yield* treeOf(worktree)
    // Refuse to project a tree read across a concurrent checkout or commit.
    if ((yield* git(worktree, 'rev-parse', '--verify', 'HEAD')) !== head) {
      return yield* failed('The task changed while making its worker checkout. Try again when it settles.')
    }
    const snapshot = yield* commitTree(worktree, tree, head, 'Althar worker workspace')
    const objectPath = yield* git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'objects')
    if (objectPath.includes('\n') || objectPath.includes('\r')) {
      return yield* failed('Git object storage with a line break in its path cannot be transferred to a worker.')
    }
    const target = yield* folder
    yield* git(target, 'init', '--quiet', '--bare', '--template=', head.length === 64 ? '--object-format=sha256' : '--object-format=sha1')
    yield* io(
      () => writeFile(join(target, 'objects', 'info', 'alternates'), objectPath + '\n', { mode: 0o600 }),
      'Could not read the worktree’s Git objects for transfer.',
    )
    yield* git(target, 'update-ref', SNAPSHOT_REF, snapshot)
    const bundle = join(target, 'workspace.bundle')
    yield* git(target, 'bundle', 'create', bundle, SNAPSHOT_REF)
    const { size } = yield* io(() => stat(bundle), 'The worker bundle was not written.')
    if (size > maxBytes || size === 0) {
      return yield* failed('The task’s Git history and changes exceed the worker bundle size limit.')
    }
    const sha256 = yield* Effect.tryPromise({
      try: async (signal) => {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(bundle, { signal })) hash.update(chunk)
        return hash.digest()
      },
      catch: () => failed('Could not verify the prepared worker workspace.'),
    })
    return { size, sha256, head, tree, contents: (signal: AbortSignal) => createReadStream(bundle, { signal }) }
  })
}

export interface WorkerGitState {
  readonly head: string
  readonly tree: string
}

/** Land the worker's changes on the exact tree and commit the home last sent or received. */
export const acceptWorkerPatch = (
  worktree: string,
  base: WorkerGitState,
  incoming: WorkerGitState & {
    readonly patch: Uint8Array
    readonly commits: Uint8Array
  },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const refuse = (reason: string) => failed(worktree, ['apply'], reason)
      const head = yield* git(worktree, 'rev-parse', '--verify', 'HEAD')
      if (head !== base.head || (yield* treeOf(worktree)) !== base.tree)
        return yield* refuse('This task’s checkout changed on the home. The worker’s changes are still on the worker.')
      if (incoming.patch.byteLength === 0 && incoming.tree !== base.tree)
        return yield* refuse('The worker reported a new tree without a patch.')
      if ((incoming.head === base.head) !== (incoming.commits.byteLength === 0))
        return yield* refuse('The worker’s commit transfer does not match its checkout.')
      if (incoming.patch.byteLength === 0 && incoming.commits.byteLength === 0) return
      const folder = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), 'althar-worker-patch-')),
          catch: () => refuse('Could not make a private folder for the worker’s changes.'),
        }),
        (path) => cleanUp(path, 'the received worker patch'),
      )
      const received = (filename: string, bytes: Uint8Array) =>
        Effect.tryPromise({
          try: async () => {
            const path = join(folder, filename)
            await writeFile(path, bytes, { mode: 0o600 })
            return path
          },
          catch: () => refuse('Could not save the worker’s changes.'),
        })
      if (incoming.commits.byteLength > 0) {
        const archive = yield* received('commits.bundle', incoming.commits)
        if ((yield* git(worktree, 'bundle', 'list-heads', archive)) !== incoming.head + ' ' + COMMITS_REF)
          return yield* refuse('The worker sent a different commit than the one it reported.')
        yield* git(
          worktree,
          '-c',
          'protocol.file.allow=always',
          'fetch',
          '--no-write-fetch-head',
          '--no-tags',
          '--no-recurse-submodules',
          archive,
          COMMITS_REF,
        )
        yield* git(worktree, 'merge-base', '--is-ancestor', base.head, incoming.head)
      }
      if (incoming.patch.byteLength > 0) {
        const patch = yield* received('files.diff', incoming.patch)
        // Git apply checks every file before updating any. Keep its checks
        // against edits made since the base was read and against escaping paths.
        yield* git(worktree, 'apply', '--whitespace=nowarn', '--', patch)
      }
      if (incoming.head !== base.head) {
        // Import the worker's original commits, with the worker's author and
        // object IDs intact. Setting the index alone keeps its remaining edits.
        yield* git(worktree, 'update-ref', 'HEAD', incoming.head, base.head)
        yield* git(worktree, 'read-tree', incoming.head)
      }
      if ((yield* treeOf(worktree)) !== incoming.tree)
        return yield* refuse('The home’s checkout does not match the worker’s checkpoint. Inspect the changes in both places.')
    }),
  )
