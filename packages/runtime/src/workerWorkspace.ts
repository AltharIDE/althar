import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, open, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanUp } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { GitFailed } from './errors'
import { commitTree, git, gitExactly, gitWithin, gitWithInput, treeOf, untouched } from './git'

const SNAPSHOT_REF = 'refs/althar/worker-snapshot'
const INDEX_REF = 'refs/althar/worker-index'
const COMMITS_REF = 'refs/althar/worker-head'

const failed = (cwd: string, args: ReadonlyArray<string>, reason: string) => new GitFailed({ cwd, args, reason, stderr: '' })

/** Long enough to bundle a large project's whole history, as a worker's first send of it does. */
const BUNDLE_TIMEOUT_MS = 30 * 60_000

/** A send's size for the thread: 12 KB, 3.4 MB, 81 MB, 1.2 GB. */
export const sendSizeWords = (bytes: number): string => {
  const units = [
    [1024 ** 3, 'GB'],
    [1024 ** 2, 'MB'],
    [1024, 'KB'],
  ] as const
  for (const [size, unit] of units) {
    if (bytes < size) continue
    const value = bytes / size
    return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} ${unit}`
  }
  return `${bytes} bytes`
}

/** What the home sent a worker as a task started there, for the thread: its size, and what it carried. */
export const sentWords = (sent: { readonly bytes: number; readonly thin: boolean; readonly keeps: boolean }, worker: string): string => {
  const size = sendSizeWords(sent.bytes)
  if (sent.thin) return `Sent ${size} to ${worker}: only what’s new to the history it keeps.`
  if (sent.keeps)
    return `Sent ${size} to ${worker}: the project’s history with the task’s changes. It keeps the history, so later sends carry only what’s new.`
  return `Sent ${size} to ${worker}: the task’s whole history with its changes. Update the worker so later sends carry only what’s new.`
}

/** What a send to a worker may leave out and how large it may be (`WorkerHistory` in the worker protocol). */
export interface WorkerSendLimits {
  readonly maxBytes: number
  /** The worker keeps the project's history: it took a send that carries only what its copy lacks. */
  readonly keeps?: boolean
  /** Commits its copy holds, with all their history: the send leaves those out. */
  readonly known?: ReadonlyArray<string>
}

/** Of `commits`, those this repository has, so a bundle can leave them out: asked of git on its input, never as arguments. */
const commitsHere = (worktree: string, commits: ReadonlyArray<string>) => {
  const asked = commits.filter((commit) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit))
  if (asked.length === 0) return Effect.succeed([] as ReadonlyArray<string>)
  return gitWithInput(worktree, asked.map((commit) => `${commit}^{commit}\n`).join(''), 'cat-file', '--batch-check=%(objectname)').pipe(
    Effect.map((output) => {
      const found = new Set(output.split('\n').map((line) => line.trim()))
      return asked.filter((commit) => found.has(commit))
    }),
    Effect.orElseSucceed(() => [] as ReadonlyArray<string>),
  )
}

/** The files the task changed and hasn't committed, by size: their total, and the largest. */
const uncommittedSizes = (worktree: string, head: string, snapshot: string) =>
  Effect.gen(function* () {
    const raw = yield* gitExactly(worktree, 'diff-tree', '-r', '-z', '--no-renames', '--diff-filter=AMT', head, snapshot)
    // `:<mode> <mode> <old> <new> <status>` then the path, each ending in NUL.
    const fields = raw.split('\0')
    const changed: Array<{ readonly path: string; readonly blob: string }> = []
    for (let at = 0; at + 1 < fields.length; at += 2) {
      const blob = fields[at]?.split(' ')[3]
      const path = fields[at + 1]
      if (blob !== undefined && path !== undefined && /^[0-9a-f]{40,64}$/.test(blob)) changed.push({ path, blob })
    }
    if (changed.length === 0) return { total: 0, largest: undefined }
    const sizes = (yield* gitWithInput(
      worktree,
      changed.map(({ blob }) => blob + '\n').join(''),
      'cat-file',
      '--batch-check=%(objectsize)',
    ))
      .split('\n')
      .map(Number)
    let total = 0
    let largest: { readonly path: string; readonly size: number } | undefined
    changed.forEach(({ path }, at) => {
      const size = sizes[at] ?? 0
      if (!Number.isFinite(size)) return
      total += size
      if (largest === undefined || size > largest.size) largest = { path, size }
    })
    return { total, largest }
  }).pipe(Effect.orElseSucceed(() => ({ total: 0, largest: undefined })))

/** Why a send is too large for the worker, and what to do: the file that makes it so, an update, or running it on the home. */
export const tooLargeWords = (
  size: number,
  limits: WorkerSendLimits,
  uncommitted: { readonly total: number; readonly largest: { readonly path: string; readonly size: number } | undefined },
): string => {
  const said = `The task’s Git history and changes come to ${sendSizeWords(size)}; the worker takes at most ${sendSizeWords(limits.maxBytes)} in one send.`
  const { largest } = uncommitted
  if (largest !== undefined && uncommitted.total * 2 >= size)
    return `${said} Most of it is ${largest.path} (${sendSizeWords(largest.size)}), which isn’t committed or ignored: add it to .gitignore, or move it out of the task’s folder.`
  if (limits.keeps !== true)
    return `${said} Update the worker: it then keeps the project’s history, takes up to 4 GB the first time, and later sends carry only what’s new.`
  return `${said} Run this task on the home instead.`
}

/**
 * Build a portable Git view of one task worktree. The synthetic commit has
 * the current HEAD as its parent and carries tracked and unignored changes.
 * A private bare repository gives it a bundle ref without changing any of
 * the task's own refs, index, configuration or working files. A worker that
 * keeps the project's history gets only what its copy lacks (`limits.known`).
 */
export const prepareWorkerWorkspace = (worktree: string, limits: WorkerSendLimits, saveIndex = false, verifiedIndex?: string) => {
  const { maxBytes } = limits
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
    const index = verifiedIndex ?? (saveIndex ? yield* git(worktree, 'write-tree') : undefined)
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
    if (index !== undefined) {
      const staged = yield* commitTree(worktree, index, head, 'Althar workspace index')
      yield* git(target, 'update-ref', INDEX_REF, staged)
    }
    // What the worker's copy holds goes no further: its commits and all before them.
    const basis = yield* commitsHere(worktree, limits.known ?? [])
    yield* gitWithin(
      BUNDLE_TIMEOUT_MS,
      target,
      'bundle',
      'create',
      bundle,
      SNAPSHOT_REF,
      ...(index === undefined ? [] : [INDEX_REF]),
      ...basis.map((commit) => '^' + commit),
    )
    const { size } = yield* io(() => stat(bundle), 'The worker bundle was not written.')
    if (size === 0) return yield* failed('The worker bundle was not written.')
    if (size > maxBytes) return yield* failed(tooLargeWords(size, limits, yield* uncommittedSizes(worktree, head, snapshot)))
    const sha256 = yield* Effect.tryPromise({
      try: async (signal) => {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(bundle, { signal })) hash.update(chunk)
        return hash.digest()
      },
      catch: () => failed('Could not verify the prepared worker workspace.'),
    })
    const range = (offset: number, length: number) =>
      io(async () => {
        const file = await open(bundle, 'r')
        try {
          const bytes = Buffer.alloc(length)
          let read = 0
          while (read < length) {
            const result = await file.read(bytes, read, length - read, offset + read)
            if (result.bytesRead === 0) throw new Error('The workspace bundle is incomplete')
            read += result.bytesRead
          }
          return bytes
        } finally {
          await file.close()
        }
      }, 'Could not read the prepared workspace.')
    return {
      size,
      sha256,
      head,
      tree,
      index,
      /** It leaves out history the worker holds: it carries only what's new to it. */
      thin: basis.length > 0,
      contents: (signal: AbortSignal) => createReadStream(bundle, { signal }),
      range,
    }
  })
}

export interface WorkerGitState {
  readonly head: string
  readonly tree: string
}

/** Materialize the worker's staged tree in Git objects without touching either active index. */
export const verifyWorkerIndex = (worktree: string, base: string, index: { readonly tree: string; readonly patch: Uint8Array }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const mismatch = () => failed(worktree, ['apply', '--cached'], 'The worker’s staged files do not match their reported Git tree.')
      if (index.patch.byteLength === 0) return index.tree === base ? base : yield* mismatch()
      const folder = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), 'althar-worker-index-')),
          catch: () => mismatch(),
        }),
        (folder) => cleanUp(folder, 'the received worker index patch'),
      )
      const patch = join(folder, 'staged.diff')
      yield* Effect.tryPromise({ try: () => writeFile(patch, index.patch, { mode: 0o600 }), catch: () => mismatch() })
      const tree = yield* untouched(
        worktree,
        Effect.gen(function* () {
          yield* git(worktree, 'read-tree', base)
          yield* git(worktree, 'apply', '--cached', '--whitespace=nowarn', '--', patch)
          return yield* git(worktree, 'write-tree')
        }),
      )
      return tree === index.tree ? tree : yield* mismatch()
    }),
  )

/** Land the worker's changes on the exact tree and commit the home last sent or received. */
export const acceptWorkerPatch = (
  worktree: string,
  base: WorkerGitState,
  incoming: WorkerGitState & {
    readonly patch: Uint8Array
    readonly commits: Uint8Array
  },
  ownsRun?: () => boolean,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const refuse = (reason: string) => failed(worktree, ['apply'], reason)
      const lost = 'The worker no longer owns this run. Its changes are still on the worker.'
      if (ownsRun?.() === false) return yield* refuse(lost)
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
      const patch = incoming.patch.byteLength === 0 ? undefined : yield* received('files.diff', incoming.patch)
      if (patch !== undefined) {
        // Verify the proposed tree in a private index before writing any home files.
        const projected = yield* untouched(
          worktree,
          Effect.gen(function* () {
            yield* git(worktree, 'read-tree', base.tree)
            yield* git(worktree, 'apply', '--cached', '--whitespace=nowarn', '--', patch)
            return yield* git(worktree, 'write-tree')
          }),
        )
        if (projected !== incoming.tree) return yield* refuse('The worker’s patch does not match its reported checkout.')
      }
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
      if (ownsRun?.() === false) return yield* refuse(lost)
      if (patch !== undefined) {
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
