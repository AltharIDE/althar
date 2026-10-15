import { blockedBeforePush, parseNulPaths } from '@althar/skills'
import { Effect } from 'effect'

import { PushRefused } from './errors'
import { gitExactly } from './git'
import { Policies, repositoryFilesOf } from './Policies'

/**
 * The paths a push would send that the commits since `base` changed (every path when there is no base): from git
 * with NUL separators and no quoting, a rename as its old and new paths, so a special character or a rename cannot
 * hide a protected path.
 */
export const pathsPushed = (cwd: string, base: string | null, head: string) =>
  (base === null
    ? gitExactly(cwd, 'ls-tree', '-r', '--name-only', '-z', head)
    : gitExactly(cwd, 'diff', '--name-only', '-z', '--no-renames', base, head)
  ).pipe(Effect.map(parseNulPaths))

/**
 * Refuses a push that would send skill or OpenSpec files off the machine unless the project's rules allow it
 * (docs/plans/skills-across-harnesses.md, section 4). It reads the paths, not who wrote them, so a file a harness
 * wrote, or one never marked, is held the same. Called before every push Althar makes for a task.
 */
export const guardPush = (input: {
  readonly projectId: string
  readonly taskId: string
  readonly remote: string
  readonly cwd: string
  readonly base: string | null
  readonly head: string
}) =>
  Effect.gen(function* () {
    const { rules } = yield* (yield* Policies).current(input.projectId as Parameters<Policies['Service']['current']>[0])
    const settings = repositoryFilesOf(rules)
    if (settings.pushProtected) return
    const blocked = blockedBeforePush(yield* pathsPushed(input.cwd, input.base, input.head), settings)
    if (blocked.length === 0) return
    const shown = blocked.slice(0, 5).map(({ path }) => path)
    const said = `${shown.join(', ')}${blocked.length > shown.length ? ` and ${blocked.length - shown.length} more` : ''}`
    return yield* new PushRefused({ taskId: input.taskId, why: 'protected', remote: input.remote, said })
  })
