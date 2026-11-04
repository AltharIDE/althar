import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { ProjectId, WorksIn } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { git as gitRead, untouched } from '../src/git'
import { Live } from '../src/Live'
import { place } from '../src/local'
import { Overlaps, overlapWords } from '../src/Overlaps'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { OTHER_TASKS, Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, listTools, repository, runtime, turns, until } from './support'

/*
 * What a lead sees of the project's other tasks, read-only (otherTasks.ts):
 * each one's brief, report and thread, and its change as it stands in its
 * folder, uncommitted work included, read without touching that folder;
 * and, where two running tasks change the same files, one heads-up to each
 * lead naming the other (Overlaps.ts).
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

const opened = (root: string) =>
  Effect.gen(function* () {
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
    return project.projectId as ProjectId
  })

const made = (projectId: ProjectId, title: string, more: { description?: string; worksIn?: WorksIn; draft?: boolean } = {}) =>
  Effect.gen(function* () {
    const created = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      ...more,
    })
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string; slug: string }>`
      SELECT w.path, k.slug FROM workspaces w JOIN tasks k ON k.id = w.task_id WHERE w.task_id = ${created.taskId}`
    return { ...created, path: workspace?.path ?? '', slug: workspace?.slug ?? '' }
  })

const leadOf = (projectId: ProjectId, task: { readonly taskId: string; readonly threadId: string }): ToolAccess => ({
  role: 'lead',
  projectId,
  threadId: task.threadId,
  sessionId: 'none',
  taskId: task.taskId,
})

/** A worktree's index as it is on disk, and whether git holds its lock: what reading it must leave as it was. */
const indexOf = (worktree: string) => {
  const index = git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
  return { bytes: readFileSync(index).toString('base64'), locked: existsSync(`${index}.lock`) }
}

describe('a lead reading another task', () => {
  it.live('finds it, reads its brief and thread, and its live change, uncommitted work included, without touching its worktree', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const mine = yield* made(projectId, 'Retry the checkout', { description: 'Retry when the card is declined.' })
      const theirs = yield* made(projectId, 'Go service for payments', { description: 'Move payments to the Go service.' })
      assert.isTrue(existsSync(theirs.path))
      // What the person said to its lead, waiting for it: no agent is at work on it here.
      const body = 'Keep the old endpoint until Friday.'
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: theirs.threadId, body }),
        threadId: theirs.threadId,
        body,
        disposition: 'after_current',
        sender: { kind: 'window' },
      })

      // Its lead committed one change, and has more not committed yet: an edit, and a new file nobody has added.
      writeFileSync(join(theirs.path, 'notes.md'), 'Payments\n')
      git(theirs.path, 'add', 'notes.md')
      git(theirs.path, 'commit', '-q', '-m', 'Notes')
      writeFileSync(join(theirs.path, 'README.md'), '# Meridian\nPayments run in Go.\n')
      mkdirSync(join(theirs.path, 'pay'))
      writeFileSync(join(theirs.path, 'pay', 'main.go'), 'package main\n')
      // A file touched since it was staged: a plain `git diff` would refresh the index's record of it, and write the index.
      utimesSync(join(theirs.path, 'notes.md'), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000))
      const before = indexOf(theirs.path)

      const lead = leadOf(projectId, mine)
      assert.includeMembers(yield* listTools(lead), ['list_tasks', 'find_tasks', 'read_task', 'read_thread', 'read_task_diff'])
      // Read-only: nothing that messages another lead or changes another task.
      assert.notIncludeMembers(yield* listTools(lead), ['message_lead', 'draft_task', 'rename_task'])

      const listed = yield* callTool(lead, 'list_tasks')
      assert.match(listed, new RegExp(`- ${mine.slug}: Retry the checkout [^\\n]*\\n {2}Yours: the task you are on; works in a worktree;`))
      assert.match(
        listed,
        new RegExp(
          `- ${theirs.slug}: Go service for payments [^\\n]*\\n {2}Works in a worktree; [^\\n]*changes README\\.md, notes\\.md, pay/main\\.go \\(2 not all committed\\)\\.`,
        ),
      )
      const found = yield* callTool(lead, 'find_tasks', { text: 'go payments' })
      assert.include(found, `- ${theirs.slug}: Go service for payments`)
      assert.include(found, 'changes README.md, notes.md, pay/main.go')

      const read = yield* callTool(lead, 'read_task', { task: theirs.slug })
      assert.include(read, 'Move payments to the Go service.')
      assert.include(read, 'Where it stands: open.')
      assert.include(read, 'read_task_diff')
      assert.notInclude(read, 'This is your own task.')
      assert.include(yield* callTool(lead, 'read_task', { task: mine.slug }), 'This is your own task.')
      assert.include(yield* callTool(lead, 'read_thread', { task: theirs.slug }), '[person] Keep the old endpoint until Friday.')

      const diff = yield* callTool(lead, 'read_task_diff', { task: theirs.slug })
      assert.include(diff, "what isn't committed included")
      assert.include(diff, '- README.md: modified, +1 −0, not all committed')
      assert.include(diff, '- notes.md: added, +1 −0')
      assert.include(diff, '- pay/main.go: added, +1 −0, not all committed')
      assert.include(diff, '+Payments run in Go.')
      assert.include(diff, '+Payments')
      assert.include(diff, 'diff --git a/pay/main.go b/pay/main.go\nnew file, not added to git yet')
      assert.include(diff, '+package main')
      // Its worktree is as it was: the index neither written nor locked, where a plain `git diff` would have written it.
      assert.deepStrictEqual(indexOf(theirs.path), before)
      git(theirs.path, 'diff')
      assert.notDeepEqual(indexOf(theirs.path), before)

      // Some of its files only; one not in its change is said, not read.
      const some = yield* callTool(lead, 'read_task_diff', { task: theirs.slug, paths: ['pay/main.go', 'go.mod'] })
      assert.include(some, '+package main')
      assert.notInclude(some, '+Payments run in Go.')
      assert.include(some, 'Not in its change, so not read: go.mod.')
      // Another project's task, or none, isn't there to read.
      assert.include(yield* callTool(lead, 'read_task_diff', { task: 'nothing-like-it' }), 'This project has no task nothing-like-it.')
    }).pipe(Effect.provide(runtime()))
  })

  it.live('reads a long change a page at a time', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const mine = yield* made(projectId, 'Retry the checkout')
      const theirs = yield* made(projectId, 'Generate the client')
      writeFileSync(join(theirs.path, 'client.ts'), Array.from({ length: 1500 }, (_, at) => `export const n${at} = ${at}`).join('\n'))
      const lead = leadOf(projectId, mine)
      const first = yield* callTool(lead, 'read_task_diff', { task: theirs.slug })
      assert.include(first, '- client.ts: added, +1500 −0, not all committed')
      assert.match(
        first,
        /\(Page 1 of 3: lines 1–600 of 150\d\. read_task_diff with page 2 reads on; pass paths to read only some files\.\)$/,
      )
      assert.notInclude(first, 'n700 ')
      const last = yield* callTool(lead, 'read_task_diff', { task: theirs.slug, page: 3 })
      assert.include(last, '+export const n1499 = 1499')
      assert.match(last, /\(Page 3 of 3: lines 1201–150\d of 150\d\. pass paths/)
    }).pipe(Effect.provide(runtime()))
  })

  it.live('reads a Local task in the person’s checkout as it stands, and only its commits once the checkout is on another branch', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const local = yield* made(projectId, 'Fix the login', { worksIn: 'checkout', draft: true })
      const mine = yield* made(projectId, 'Retry the checkout')
      const lead = leadOf(projectId, mine)
      // Planned, it hasn't taken the checkout: nothing there is its yet.
      assert.include(yield* callTool(lead, 'read_task_diff', { task: local.slug }), 'it hasn’t started there yet.')
      assert.deepStrictEqual(yield* place(local.taskId, 'checkout'), { kind: 'ready' })
      assert.include(yield* callTool(lead, 'read_task_diff', { task: local.slug }), 'It has changed no files yet.')
      writeFileSync(join(root, 'README.md'), '# Meridian\nLog in with a passkey.\n')
      writeFileSync(join(root, 'login.ts'), 'export const login = () => {}\n')
      const before = indexOf(root)

      assert.include(yield* callTool(lead, 'list_tasks'), "Works Local, in the person's checkout")
      const diff = yield* callTool(lead, 'read_task_diff', { task: local.slug })
      assert.include(diff, "the person's own checkout it works in, ")
      assert.include(diff, `${basename(root)}, on althar/fix-the-login, as it stands now`)
      assert.include(diff, '+Log in with a passkey.')
      assert.include(diff, '+export const login = () => {}')
      assert.deepStrictEqual(indexOf(root), before)

      // Its lead commits the README; the person goes back to main, the new file still lying there.
      const branch = git(root, 'branch', '--show-current')
      git(root, 'commit', '-q', '-am', 'Passkeys')
      git(root, 'checkout', '-q', 'main')
      const later = yield* callTool(lead, 'read_task_diff', { task: local.slug })
      assert.include(later, `its branch ${branch} as committed`)
      assert.include(later, '+Log in with a passkey.')
      assert.notInclude(later, 'login.ts')
    }).pipe(Effect.provide(runtime()))
  })
})

describe('a lead reading a task whose folder was removed', () => {
  it.live('reads its branch’s commits alone', () => {
    const root = repository()
    return Effect.gen(function* () {
      const projectId = yield* opened(root)
      const mine = yield* made(projectId, 'Retry the checkout')
      const theirs = yield* made(projectId, 'Go service for payments')
      writeFileSync(join(theirs.path, 'notes.md'), 'Payments\n')
      git(theirs.path, 'add', 'notes.md')
      git(theirs.path, 'commit', '-q', '-m', 'Notes')
      writeFileSync(join(theirs.path, 'draft.md'), 'Not committed\n')
      rmSync(theirs.path, { recursive: true, force: true, maxRetries: 5 })
      const diff = yield* callTool(leadOf(projectId, mine), 'read_task_diff', { task: theirs.slug })
      assert.include(diff, 'as committed')
      assert.include(diff, 'its folder was removed, so nothing uncommitted is read')
      assert.include(diff, '+Payments')
      assert.notInclude(diff, 'draft.md')
    }).pipe(Effect.provide(runtime()))
  })
})

describe('git in a folder someone else works in', () => {
  it.live('reads it on a copy of its index, which git refreshes in its place', () => {
    const root = repository()
    return Effect.gen(function* () {
      utimesSync(join(root, 'README.md'), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000))
      const before = indexOf(root)
      // `git diff` against the index refreshes it as it reads, and writes it back under its lock: here, only the copy.
      yield* untouched(root, gitRead(root, 'diff'))
      assert.deepStrictEqual(indexOf(root), before)
      yield* gitRead(root, 'diff')
      assert.notDeepEqual(indexOf(root), before)
    })
  })
})

describe('a heads-up of another task changing the same files', () => {
  it.live('tells each of two running leads once, naming the other, however often they edit', () => {
    const root = repository()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const live = yield* Live
      const overlaps = yield* Overlaps
      const projectId = yield* opened(root)
      const first = yield* made(projectId, 'Retry the checkout', { description: '[lead:wait]' })
      const second = yield* made(projectId, 'Go service for payments', { description: '[lead:wait]' })
      // A third changes the file too, but nobody is at work on it: no heads-up names it.
      const idle = yield* made(projectId, 'Tidy the README')
      for (const task of [first, second]) {
        yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code' })
        yield* until(turns(task.threadId), (rows) => rows.some((row) => row.state === 'delivered'))
      }
      writeFileSync(join(idle.path, 'README.md'), '# Tidy\n')
      writeFileSync(join(second.path, 'README.md'), '# Meridian\nPayments run in Go.\n')
      writeFileSync(join(second.path, 'go.mod'), 'module pay\n')
      writeFileSync(join(first.path, 'README.md'), '# Meridian\nRetry declined cards.\n')

      const told = (threadId: string) =>
        sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Heads-up:%' ORDER BY sequence`
      // The first lead's edit ends: both leads hear of it.
      const edited = (threadId: string, toolCallId: string) =>
        live.publish({
          _tag: 'Agent',
          threadId,
          event: { _tag: 'ToolCall', toolCallId, title: 'Edit README.md', kind: 'edit', status: 'completed' },
        })
      yield* edited(first.threadId, 'call-1')
      const [heard] = yield* until(told(first.threadId), (rows) => rows.length === 1)
      assert.strictEqual(heard?.body, overlapWords({ slug: second.slug, title: 'Go service for payments' }, ['README.md']))
      assert.deepStrictEqual(
        (yield* until(told(second.threadId), (rows) => rows.length === 1)).map((row) => row.body),
        [overlapWords({ slug: first.slug, title: 'Retry the checkout' }, ['README.md'])],
      )

      // Edits after it, either lead's, its turn ending, and looking again say nothing more.
      for (const at of [2, 3, 4]) yield* edited(first.threadId, `call-${at}`)
      yield* edited(second.threadId, 'call-5')
      yield* live.publish({ _tag: 'TurnEnded', threadId: second.threadId, turnId: 'turn', state: 'completed' })
      yield* overlaps.look(first.taskId)
      yield* overlaps.look(second.taskId)
      assert.lengthOf(yield* told(first.threadId), 1)
      assert.lengthOf(yield* told(second.threadId), 1)
      assert.lengthOf(yield* told(idle.threadId), 0)
      const kept = yield* sql<{ taskId: string }>`
        SELECT aggregate_id AS task_id FROM record_events WHERE type = 'task.overlap_noticed' ORDER BY sequence`
      assert.sameMembers(
        kept.map((row) => row.taskId),
        [first.taskId, second.taskId],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { countdown: Duration.hours(1) })))
  })
})

describe('a heads-up to a lead between turns', () => {
  it.live('waits until it is at work: the lead in a turn hears of it, and one whose turn ended isn’t woken', () => {
    const root = repository()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const live = yield* Live
      const projectId = yield* opened(root)
      const working = yield* made(projectId, 'Retry the checkout', { description: '[lead:wait]' })
      const resting = yield* made(projectId, 'Go service for payments')
      yield* sessions.start({ threadId: working.threadId, agentId: 'claude-code' })
      yield* sessions.start({ threadId: resting.threadId, agentId: 'claude-code' })
      yield* until(turns(working.threadId), (rows) => rows.some((row) => row.state === 'delivered'))
      yield* until(turns(resting.threadId), (rows) => rows.length >= 1 && rows.every((row) => row.state === 'completed'))
      writeFileSync(join(resting.path, 'README.md'), '# Meridian\nPayments run in Go.\n')
      writeFileSync(join(working.path, 'README.md'), '# Meridian\nRetry declined cards.\n')

      const told = (threadId: string) =>
        sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Heads-up:%'`
      yield* live.publish({
        _tag: 'Agent',
        threadId: working.threadId,
        event: { _tag: 'ToolCall', toolCallId: 'call-1', title: 'Edit README.md', kind: 'edit', status: 'pending' },
      })
      yield* live.publish({
        _tag: 'Agent',
        threadId: working.threadId,
        event: { _tag: 'ToolCallUpdate', toolCallId: 'call-1', status: 'completed' },
      })
      yield* until(told(working.threadId), (rows) => rows.length === 1)
      yield* (yield* Overlaps).look(resting.taskId)
      assert.lengthOf(yield* told(resting.threadId), 0)
      // Its pair isn't kept as told: it hears of it once it changes a file the other changes while at work.
      const kept = yield* sql<{ taskId: string }>`SELECT aggregate_id AS task_id FROM record_events WHERE type = 'task.overlap_noticed'`
      assert.deepStrictEqual(
        kept.map((row) => row.taskId),
        [working.taskId],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { countdown: Duration.hours(1) })))
  })
})

describe('a lead’s brief', () => {
  it('says what it can read of other tasks, and when to', () => {
    assert.include(OTHER_TASKS, 'read_task_diff')
    assert.include(OTHER_TASKS, 'before you change code another open task changes, and where your brief names another task')
    assert.include(OTHER_TASKS, "you can't message another task's lead")
  })
})
