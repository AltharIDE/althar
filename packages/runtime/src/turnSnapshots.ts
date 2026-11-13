import { lstat, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { Effect, Schema } from 'effect'

import { UndoRefused } from './errors'
import { commitTree, git, gitExactly, treeOf, untouched } from './git'

/** Kept under a private ref, independent of the task's branch and staging. */
export const TurnSnapshot = Schema.Struct({ ref: Schema.String, head: Schema.String, branch: Schema.String })
export type TurnSnapshot = typeof TurnSnapshot.Type
export const WorkspaceCheckpoint = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  before: TurnSnapshot,
  after: Schema.optional(TurnSnapshot),
})
export const TurnCheckpoints = Schema.Array(WorkspaceCheckpoint)

export interface RestorePlan {
  readonly cwd: string
  readonly before: TurnSnapshot
  readonly recovery: TurnSnapshot
  readonly paths: ReadonlyArray<string>
}

const refused = (message: string, files: ReadonlyArray<string> = []) => new UndoRefused({ message, files: [...files] })
const names = (text: string) => text.split('\0').filter((path) => path !== '')
const batches = (paths: ReadonlyArray<string>) =>
  Array.from({ length: Math.ceil(paths.length / 100) }, (_, n) => paths.slice(n * 100, n * 100 + 100))

/** Includes untracked files, but not ignored output. Capture never moves HEAD. */
export const takeSnapshot = (cwd: string, ref: string) =>
  Effect.gen(function* () {
    const head = yield* git(cwd, 'rev-parse', 'HEAD')
    const branch = yield* git(cwd, 'rev-parse', '--symbolic-full-name', 'HEAD')
    const tree = yield* treeOf(cwd)
    const commit = yield* commitTree(cwd, tree, head, 'Althar chat checkpoint')
    yield* git(cwd, 'update-ref', ref, commit)
    return { ref, head, branch } satisfies TurnSnapshot
  })

export const changedPaths = (cwd: string, from: string, to: string, paths?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found: string[] = []
    for (const batch of paths === undefined ? [[]] : batches(paths)) {
      found.push(
        ...names(yield* gitExactly(cwd, '--literal-pathspecs', 'diff', '--name-only', '--no-renames', '-z', from, to, '--', ...batch)),
      )
    }
    return found
  })

const entries = (cwd: string, ref: string, paths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Map<string, string>()
    for (const batch of batches(paths)) {
      const raw = yield* gitExactly(cwd, '--literal-pathspecs', 'ls-tree', '-r', '-z', ref, '--', ...batch)
      for (const line of names(raw)) {
        const tab = line.indexOf('\t')
        if (tab >= 0) found.set(line.slice(tab + 1), line.slice(0, 6))
      }
    }
    return found
  })

/** Never follow a link out of the worktree, including a link in a parent folder. */
const plainPaths = (cwd: string, paths: ReadonlyArray<string>, expected: ReadonlyMap<string, string>) =>
  Effect.tryPromise({
    try: async () => {
      for (const path of paths) {
        const inside = relative(resolve(cwd), resolve(cwd, path))
        if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || inside === '')
          throw refused('A file is outside the task’s folder.', [path])
        for (let folder = dirname(path); folder !== '.'; folder = dirname(folder)) {
          const stat = await lstat(resolve(cwd, folder)).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
          if (stat !== null && !stat.isDirectory()) throw refused('A folder changed since this turn. Nothing was undone.', [path])
        }
        const mode = expected.get(path)
        const stat = await lstat(resolve(cwd, path)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (
          (mode !== undefined && !['100644', '100755'].includes(mode)) ||
          (stat !== null && !stat.isFile()) ||
          (mode === undefined && stat !== null)
        )
          throw refused('A file changed since this turn. Nothing was undone.', [path])
      }
    },
    catch: (error) => (error instanceof UndoRefused ? error : refused('The task’s files could not be checked. Nothing was undone.')),
  })

const check = (cwd: string, expected: TurnSnapshot, paths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (
      (yield* git(cwd, 'rev-parse', 'HEAD')) !== expected.head ||
      (yield* git(cwd, 'rev-parse', '--symbolic-full-name', 'HEAD')) !== expected.branch
    )
      return yield* refused('The task’s branch changed since this turn. Nothing was undone.')
    yield* plainPaths(cwd, paths, yield* entries(cwd, expected.ref, paths))
    const current = yield* treeOf(cwd)
    const conflicts = yield* changedPaths(cwd, expected.ref, current, paths)
    if (conflicts.length > 0)
      return yield* refused('These files changed after the turn. Keep or move those edits before undoing.', conflicts)
    for (const batch of batches(paths)) {
      const staged = names(yield* gitExactly(cwd, '--literal-pathspecs', 'diff', '--cached', '--name-only', '-z', '--', ...batch))
      if (staged.length > 0) return yield* refused('Unstage these files before undoing. Their staged changes have been kept.', staged)
    }
  })

/** Preflight every workspace before applying any plan. Recovery refs survive a failed restore. */
export const planRestore = (
  cwd: string,
  before: TurnSnapshot,
  after: TurnSnapshot,
  recoveryRef: string,
  affected?: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const paths = affected ?? (yield* changedPaths(cwd, before.ref, after.ref))
    yield* check(cwd, after, paths)
    const original = yield* entries(cwd, before.ref, paths)
    if ([...original.values()].some((mode) => mode !== '100644' && mode !== '100755'))
      return yield* refused('This turn changed a link or a submodule. Restore those files with Git instead.', paths)
    const recovery = yield* takeSnapshot(cwd, recoveryRef)
    return { cwd, before, recovery, paths } satisfies RestorePlan
  })

const putBack = (plan: RestorePlan, snapshot: TurnSnapshot) =>
  Effect.gen(function* () {
    const present = yield* entries(plan.cwd, snapshot.ref, plan.paths)
    // All paths have been checked before the first write. checkout-index uses a private index, including for binary files.
    for (const path of plan.paths.filter((path) => !present.has(path))) {
      yield* Effect.tryPromise({
        // A single checked plain file, never recursively: deleting this file is the requested restore itself.
        // oxlint-disable-next-line althar/one-removal
        try: () => rm(resolve(plan.cwd, path), { force: true }),
        catch: () => refused('A file could not be restored.', [path]),
      })
    }
    yield* untouched(
      plan.cwd,
      Effect.gen(function* () {
        yield* git(plan.cwd, 'read-tree', snapshot.ref)
        for (const batch of batches([...present.keys()])) yield* git(plan.cwd, 'checkout-index', '--force', '--', ...batch)
      }),
    )
  })

export const applyRestore = (plan: RestorePlan) => Effect.andThen(check(plan.cwd, plan.recovery, plan.paths), putBack(plan, plan.before))
export const rollBackRestore = (plan: RestorePlan) =>
  Effect.gen(function* () {
    if (
      (yield* git(plan.cwd, 'rev-parse', 'HEAD')) !== plan.recovery.head ||
      (yield* git(plan.cwd, 'rev-parse', '--symbolic-full-name', 'HEAD')) !== plan.recovery.branch
    )
      return yield* refused('The branch changed while an undo was interrupted. Its saved recovery files have been kept.')
    const current = yield* treeOf(plan.cwd)
    const fromBefore = new Set(yield* changedPaths(plan.cwd, plan.before.ref, current, plan.paths))
    const fromRecovery = yield* changedPaths(plan.cwd, plan.recovery.ref, current, plan.paths)
    const conflicts = fromRecovery.filter((path) => fromBefore.has(path))
    if (conflicts.length > 0)
      return yield* refused('These files changed during an interrupted undo. Their saved recovery files have been kept.', conflicts)
    yield* plainPaths(plan.cwd, plan.paths, yield* entries(plan.cwd, current, plan.paths))
    yield* putBack(plan, plan.recovery)
  })
