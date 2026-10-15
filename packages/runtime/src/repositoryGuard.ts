import { blockedBeforeCommit, blockedBeforePush, parseNulPaths } from '@althar/skills'
import { Effect } from 'effect'

import { PushRefused } from './errors'
import { gitExactly, gitOutcome } from './git'
import { Policies, repositoryFilesOf } from './Policies'

/**
 * The paths a push would send that the commits since `base` changed: from git with NUL separators and no quoting,
 * a rename as its old and new paths, so a special character or a rename cannot hide a protected path. With no base
 * recorded, the base is where the branch left `ref` (the repository's default branch); only if that cannot be found
 * either is every path in the head counted, so that a push is held rather than let through unseen.
 */
export const pathsPushed = (cwd: string, base: string | null, head: string, ref?: string) =>
  Effect.gen(function* () {
    let from = base
    if (from === null && ref !== undefined) {
      const found = yield* gitOutcome(cwd, 'merge-base', head, ref)
      from = found.code === 0 && found.stdout !== '' ? found.stdout : null
    }
    const listed = yield* from === null
      ? gitExactly(cwd, 'ls-tree', '-r', '--name-only', '-z', head)
      : gitExactly(cwd, 'diff', '--name-only', '-z', '--no-renames', from, head)
    return parseNulPaths(listed)
  })

/**
 * Refuses a push that would send skill or OpenSpec files off the machine unless the project's rules allow it
 * (docs/plans/skills-across-harnesses.md, section 4). Both consents are needed: writing the class of file into the
 * repository (`writeSkills`, `writeOpenSpec`) and pushing it (`pushProtected`). A harness commits in the worktree
 * by itself, where Althar cannot check its staging, so this is the first point Althar controls: the commits are
 * checked by path, whoever wrote them, before they leave. Called before every push Althar makes for a task.
 */
export const guardPush = (input: {
  readonly projectId: string
  readonly taskId: string
  readonly remote: string
  readonly cwd: string
  readonly base: string | null
  /** The repository's default branch, for a workspace with no recorded base commit. */
  readonly ref?: string
  readonly head: string
}) =>
  Effect.gen(function* () {
    const { rules } = yield* (yield* Policies).current(input.projectId as Parameters<Policies['Service']['current']>[0])
    const settings = repositoryFilesOf(rules)
    const paths = yield* pathsPushed(input.cwd, input.base, input.head, input.ref)
    const blocked = [...new Set([...blockedBeforeCommit(paths, settings), ...blockedBeforePush(paths, settings)].map(({ path }) => path))]
    if (blocked.length === 0) return
    const shown = blocked.slice(0, 5)
    const said = `${shown.join(', ')}${blocked.length > shown.length ? ` and ${blocked.length - shown.length} more` : ''}`
    return yield* new PushRefused({ taskId: input.taskId, why: 'protected', remote: input.remote, said })
  })
