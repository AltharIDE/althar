import { blockedBeforeCommit, blockedBeforePush, parseNulPaths, protectedRoot } from '@althar/skills'
import { Effect } from 'effect'

import { PushRefused } from './errors'
import { gitExactly, gitOutcome } from './git'
import { Policies, repositoryFilesOf } from './Policies'

/** Where commits come from that are already off the machine, or came onto it from elsewhere: not the task's to answer for. */
const ELSEWHERE = ['--remotes', '--glob=refs/althar/base/*', '--glob=refs/althar/pushed/*', '--glob=refs/althar/pull-request/*']

/**
 * The paths a push would send that the task's own commits changed: those in `head` that no remote, nor the default
 * branch Althar merged in, nor what it pushed before, already has, past `base` and `ref` (the repository's default
 * branch) where they are found. A merge counts only for what its resolution changed against every parent, so files
 * that came in with the default branch are not the task's, while a protected file slipped into a resolution is. From
 * git with NUL separators and no quoting, a rename as its old and new paths, so a special character or a rename
 * cannot hide a protected path. With nothing found to stop at, every commit in the head counts, so that a push is held
 * rather than let through unseen.
 */
export const pathsPushed = (cwd: string, base: string | null, head: string, ref?: string) =>
  Effect.gen(function* () {
    const stops = yield* stopsOf(cwd, base, ref)
    const listed = yield* gitExactly(
      cwd,
      'log',
      '-z',
      '--format=',
      '--name-only',
      '--no-renames',
      '--diff-merges=dense-combined',
      head,
      '--not',
      ...ELSEWHERE,
      ...stops,
    )
    return [...new Set(parseNulPaths(listed))]
  })

/** The commits `base` and `ref` name, where they are found. */
const stopsOf = (cwd: string, base: string | null, ref?: string) =>
  Effect.gen(function* () {
    const stops: Array<string> = []
    for (const candidate of [base, ref]) {
      if (candidate === null || candidate === undefined) continue
      const found = yield* gitOutcome(cwd, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`)
      if (found.code === 0 && found.stdout !== '') stops.push(found.stdout)
    }
    return stops
  })

/**
 * The paths that are below a protected directory the repository already tracked where the task started (or on its
 * default branch): a repository that versions its own skills or OpenSpec specs keeps doing so, and only a protected
 * directory the task brought in is held back.
 */
const ownedByRepository = (cwd: string, base: string | null, ref: string | undefined, paths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const stops = yield* stopsOf(cwd, base, ref)
    const directories = [...new Set(paths.flatMap((path) => protectedRoot(path)?.directory ?? []))]
    const tracked = new Set<string>()
    for (const directory of directories)
      for (const stop of stops) {
        const found = yield* gitOutcome(cwd, 'cat-file', '-e', `${stop}:${directory}`)
        if (found.code === 0) {
          tracked.add(directory)
          break
        }
      }
    return new Set(paths.filter((path) => tracked.has(protectedRoot(path)?.directory ?? '')))
  })

/**
 * Refuses a push that would send skill or OpenSpec files off the machine unless the project's rules allow it
 * (docs/plans/skills-across-harnesses.md, section 4), where the repository did not already track their directory. Both consents are needed: writing the class of file into the
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
    const pushed = yield* pathsPushed(input.cwd, input.base, input.head, input.ref)
    const owned = yield* ownedByRepository(input.cwd, input.base, input.ref, pushed)
    const paths = pushed.filter((path) => !owned.has(path))
    const held = [...blockedBeforeCommit(paths, settings), ...blockedBeforePush(paths, settings)]
    const blocked = [...new Set(held.map(({ path }) => path))]
    if (blocked.length === 0) return
    // Which switches are off for what was held back, so the person is told the ones that would let it go.
    const needs = (['writeSkills', 'writeOpenSpec', 'pushProtected'] as const).filter((setting) =>
      held.some(({ kind, reason }) =>
        setting === 'pushProtected'
          ? reason === 'push-off'
          : reason === 'write-off' && kind === (setting === 'writeSkills' ? 'skills' : 'openspec'),
      ),
    )
    const shown = blocked.slice(0, 5)
    const said = `${shown.join(', ')}${blocked.length > shown.length ? ` and ${blocked.length - shown.length} more` : ''}`
    return yield* new PushRefused({ taskId: input.taskId, why: 'protected', remote: input.remote, said, needs })
  })
