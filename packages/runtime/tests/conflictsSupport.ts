import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import type { IdleOptions } from '../src/Config'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeConnectors, HOST, notices, runtime, turns, until } from './support'

/* What the conflicts tests share: the runtime they run on, git, a host that reports conflicts, and what they read back. */

/** A lead that has left something running is done a moment after, not half a minute: a test doesn't wait that long. */
export const runtimeWith = (services: { readonly github?: FakeService } = {}, idle: IdleOptions = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        {},
        { connectors: fakeConnectors(services), listenEvery: Duration.millis(100), idle: { quiet: Duration.millis(300), ...idle } },
      ),
    ),
  )

export const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd, stdio: 'pipe' })
    .toString()
    .trim()

/** Whether git's merge of two commits in a repository conflicts, as a host works it out. */
export const conflictsIn = (cwd: string, into: string, from: string) => {
  try {
    git(cwd, 'merge-tree', '--write-tree', into, from)
    return false
  } catch {
    return true
  }
}

/** Commits a change to the file the lead's `[lead:edit]` writes, on the repository's `main`: the default branch moves on. */
export const moveMainOn = (root: string, text = 'rate limits\n') => {
  writeFileSync(join(root, 'change.txt'), text)
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'Limit rates')
}

/** Opens the repository as a project, with the rule on or not, and asks its coordinator for a change. */
export const ask = (working: string, body: string, resolveConflicts: boolean) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (resolveConflicts) yield* (yield* Policies).set(project.projectId, { resolveConflicts: true }, (yield* Instance).personId)
    const threadId = yield* coordinator.thread(project.projectId)
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    return project.projectId
  })

export const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** The task's card now: where it stands, the step it is on, and why the lead handed a round back, if it did. */
export const cardOf = (projectId: string) =>
  Effect.map(cards(projectId), ([card]) => ({ phase: card?.phase, step: card?.step, handedBack: card?.handedBack ?? null }))

/** Whether the task's lead is in a turn Althar sent: not, between turns, waiting on what it left running. */
export const inTurn = (threadId: string) =>
  Effect.map(
    Effect.flatMap(Sessions, (sessions) => sessions.running(threadId)),
    (running) => Option.exists(running, (session) => session.turnRunning),
  )

/** The task's worktree, by its repository's slug. */
export const worktreeOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [worktree] = yield* sql<{ slug: string; path: string }>`
      SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${taskId}`
    return { slug: worktree?.slug ?? '', path: worktree?.path ?? '' }
  })

/** Merges the task's branch here at its head now, as the person's press does. */
export const mergeHere = (taskId: string) =>
  Effect.gen(function* () {
    const { slug, path } = yield* worktreeOf(taskId)
    return yield* (yield* Changes).mergeHere(taskId, [{ repository: slug, head: git(path, 'rev-parse', 'HEAD') }])
  })

export const cantOf = (error: unknown) => {
  const said = error as { readonly _tag?: string; readonly why?: string; readonly detail?: string }
  return [said._tag, said.why, said.detail]
}

export const rounds = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ state: string; attempt: number; url: string | null; pushedHead: string | null }>`
      SELECT state, attempt, pull_request_url AS url, pushed_head FROM conflict_resolutions WHERE task_id = ${taskId} ORDER BY created_at`,
  )

/** What the lead was asked, in the task's thread. */
export const asked = (threadId: string) =>
  Effect.map(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} ORDER BY sequence`,
    ),
    (rows) => rows.map((row) => row.body).filter((body) => body.includes('Bring the branch up to date')),
  )

/** What the lead's brief says Althar pushes for it, where the project has it resolve conflicts. */
export const PUSHED_FOR_IT =
  "Commit the merge as soon as the conflicts are settled and the quick checks pass, and don't end your turn with it uncommitted or while you wait on something running in the background: Althar looks at the branch when your turn ends. If the full test suites then find something, fix it in one follow-up commit on top of the merge. On a pull request, Althar pushes that merge itself once you commit it, with that one fix if you made it, and then a fix you commit on top when Althar tells you its checks failed, as one commit. Nothing else you commit is pushed for you, and you still never push."

/** The lead's brief: its first turn. */
export const briefOf = (threadId: string) => Effect.map(turns(threadId), (all) => all[0]?.prompt ?? '')

export const titled = (threadId: string, start: string) =>
  until(notices(threadId), (all) => all.some((notice) => notice.title?.startsWith(start) === true), Duration.seconds(20))

/** The task's own say on its lead resolving conflicts, as its menu sets it. */
export const taskSays = (taskId: string, resolveConflicts: boolean | null) =>
  Effect.gen(function* () {
    const envelope = yield* Runtime.envelope('task.set_conflicts', { taskId, resolveConflicts })
    yield* (yield* Changes).setResolveConflicts({ envelope, taskId, resolveConflicts })
  })

export type Checks = ReadonlyArray<{ readonly name: string; readonly state: 'passed' | 'failed' | 'running'; readonly log?: string }>
export const PASSED: Checks = [{ name: 'test', state: 'passed' }]
export const RUNNING: Checks = [{ name: 'test', state: 'running' }]
export const FAILED: Checks = [{ name: 'test', state: 'failed', log: 'FAIL limit.test.ts' }]

/** Whether a commit the host has holds what the default branch moved on with: the resolution, or after it. */
export const holdsMain = (bare: string, sha: string) => {
  try {
    return git(bare, 'show', `${sha}:change.txt`).includes('rate limits')
  } catch {
    return false
  }
}
/** Whether a commit the host has holds the lead's fix for its checks. */
export const holdsFix = (bare: string, sha: string) => {
  try {
    git(bare, 'cat-file', '-e', `${sha}:fixed.txt`)
    return true
  } catch {
    return false
  }
}

/**
 * A GitHub whose pull request conflicts when the bare repository's `main`
 * and the task's branch do, with the checks it runs on each commit.
 */
export const hostOf = (
  bare: string,
  checks: (sha: string) => Checks | undefined = () => undefined,
  /** Each time the host says the pull request conflicts. */
  conflicting: () => void = () => {},
) => {
  const tip = () => {
    try {
      return git(bare, 'rev-parse', 'althar/add-a-retry')
    } catch {
      return null
    }
  }
  const github = makeFakeService({
    pushUrl: () => bare,
    headOf: tip,
    conflictsOf: () => {
      if (tip() === null) return undefined
      const conflicts = conflictsIn(bare, 'main', 'althar/add-a-retry')
      if (conflicts) conflicting()
      return conflicts
    },
    checksFor: (_, sha) => checks(sha),
  })
  github.addRepository(['meridian', 'api'])
  return github
}

export const connect = Effect.gen(function* () {
  const connections = yield* Connections
  const instance = yield* Instance
  return yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
})

/** The default branch moves on where the host has it, conflicting with what the task changed. */
export const moveHostMainOn = (working: string, bare: string, text?: string) => {
  moveMainOn(working, text)
  git(working, 'push', '-q', bare, 'main')
}

/** A task that ends in a pull request, with the rule on, as the lead's markers say: its card once the pull request is open. */
export const opened = (working: string, markers: string, resolveConflicts = true) =>
  Effect.gen(function* () {
    yield* connect
    const projectId = yield* ask(
      working,
      `Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] ${markers}`,
      resolveConflicts,
    )
    const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change !== null, Duration.seconds(20))
    return { projectId, taskId: task?.taskId ?? '', threadId: task?.threadId ?? '' }
  })

/** Every input the lead was given in the thread. */
export const given = (threadId: string) =>
  Effect.map(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} ORDER BY sequence`,
    ),
    (rows) => rows.map((row) => row.body),
  )

/** Until the lead has committed the merge in the task's worktree: it is working still, as `[lead:resolve-hold]` does. */
export const mergedHere = (taskId: string) =>
  Effect.gen(function* () {
    const { path } = yield* worktreeOf(taskId)
    yield* until(
      Effect.sync(() => [git(path, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length]),
      ([parts]) => parts === 3,
      Duration.seconds(20),
    )
  })

/** Until the lead has committed its fix for the checks in the task's worktree: it is working still, as `[lead:fix-hold]` does. */
export const fixedHere = (taskId: string) =>
  Effect.gen(function* () {
    const { path } = yield* worktreeOf(taskId)
    yield* until(
      Effect.sync(() => [holdsFix(path, 'HEAD')]),
      ([fixed]) => fixed === true,
      Duration.seconds(20),
    )
  })
