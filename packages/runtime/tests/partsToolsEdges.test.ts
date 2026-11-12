import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { makeFakeService, type FakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, notices, runtime, until } from './support'

/*
 * The parts tools at their edges (a task is a conversation plus parts,
 * "Changing parts"): what add_part, change_part and remove_part ask for and
 * refuse, each part's own move as they make it, and what start_change
 * refuses, all in the words the lead or the coordinator that called them
 * reads.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  return { working, bare, github }
}

/** A colleague's pull request on the host, from a branch of theirs a commit past main. */
const colleagues = (working: string, bare: string, github: FakeService, branch: string) => {
  git(working, 'checkout', '-q', '-b', branch, 'main')
  writeFileSync(join(working, `${branch}.ts`), `export const ${branch.replaceAll('-', '')} = 2\n`)
  git(working, 'add', '.')
  git(working, 'commit', '-q', '-m', `Write ${branch}`)
  const head = git(working, 'rev-parse', 'HEAD')
  git(working, 'checkout', '-q', 'main')
  git(working, 'push', '-q', bare, branch)
  const pull = github.addPullRequest({ path: ['meridian', 'api'], title: 'Back off', author: 'dana', source: branch, headSha: head })
  git(working, 'push', '-q', bare, `${head}:refs/pull/${pull.number}/head`)
  return pull
}

/** A pull request opened by hand from the task's own branch, at its head: the one it would follow. */
const opensByHand = (worktree: string, bare: string, github: FakeService, branch: string) => {
  git(worktree, 'push', '-q', bare, branch)
  return github.addPullRequest({
    path: ['meridian', 'api'],
    title: 'Add a retry',
    author: 'nine',
    source: branch,
    headSha: git(worktree, 'rev-parse', 'HEAD'),
  })
}

/** The pull requests the task follows as changes of its own, and whether it still hears them. */
const followed = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ url: string; listening: number }>`
      SELECT url, listening FROM external_links WHERE task_id = ${taskId} AND kind = 'change' ORDER BY created_at`
  })

/** GitHub connected, the repository opened as a project, a task in it with its worktree on its branch, and the tools of its lead and the coordinator. */
const aTask = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Add a retry' }),
      projectId: project.projectId,
      title: 'Add a retry',
    })
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: project.projectId,
      threadId: yield* (yield* Coordinator).thread(project.projectId),
      sessionId: 'none',
      taskId: null,
    }
    const lead: ToolAccess = { role: 'lead', projectId: project.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
    return { ...task, projectId: project.projectId, coordinator, lead }
  })

const workspacesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      id: string
      name: string | null
      branch: string
      toward: string | null
      state: string
      kind: string | null
      reviewing: string | null
      waitsFor: string | null
    }>`
      SELECT id, name, branch, toward, state, kind, reviewing, waits_for FROM workspaces WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

const shelfOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE id = ${taskId}`
    return task?.shelf ?? null
  })

describe('adding a part', () => {
  it.live('asks for the pull request a review or a followed one needs, and leaves its review and its Access to others', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const add = (args: Record<string, unknown>) => callTool(task.lead, 'add_part', { why: 'It needs it.', ...args })
      assert.strictEqual(yield* add({ part: 'reviewing' }), 'Name the pull request it reviews: pull_request.')
      assert.strictEqual(yield* add({ part: 'output' }), 'Name the pull request it follows: pull_request.')
      // change_part takes what isn't its own as add_part does.
      assert.strictEqual(
        yield* callTool(task.lead, 'change_part', { part: 'output', why: 'It needs it.' }),
        'Name the pull request it follows: pull_request.',
      )
      // Its review comes from its plan, and running an outside author's code is the person's word.
      assert.strictEqual(
        yield* add({ part: 'checked_by' }),
        `${task.slug}'s review comes from its plan: a quick task gets one with make_it_a_change; a planned one has it already, and remove_part takes it away.`,
      )
      assert.strictEqual(
        yield* add({ part: 'access' }),
        'Every task has its Access: running an outside author’s code is the person’s word alone (Run it). Suggest it to them.',
      )
      // Nothing changed: its one worktree, as it was.
      assert.lengthOf(yield* workspacesOf(task.taskId), 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('starts another change beside a worktree that has its branch once it is given a name, with why in the thread', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      assert.strictEqual(
        yield* callTool(task.lead, 'add_part', { part: 'workspace', why: 'To write the fix.' }),
        `${task.slug} has a worktree with its branch already: to start another change beside it, give it a name.`,
      )
      assert.match(
        yield* callTool(task.coordinator, 'add_part', { task: task.slug, part: 'workspace', name: 'Docs', why: 'Docs ship apart.' }),
        new RegExp(`^Started a change of ${task.slug}, “Docs”: its worktree is .*, on althar/docs, working toward main\\.`),
      )
      assert.match(
        yield* callTool(task.lead, 'add_part', { part: 'workspace', name: 'Notes' }),
        new RegExp(`^Started a change of ${task.slug}, “Notes”`),
      )
      assert.deepStrictEqual(
        (yield* workspacesOf(task.taskId)).map((one) => one.name),
        [null, 'Docs', 'Notes'],
      )
      // The thread marks each as a step, with why where it was given, and who split it.
      const steps = (yield* notices(task.threadId)).filter((notice) => notice.title?.startsWith('New change'))
      assert.deepStrictEqual(
        steps.map((step): ReadonlyArray<string | null> => [
          step.title ?? '',
          step.description ?? null,
          (step.step as unknown as { by: string }).by,
        ]),
        [
          ['New change · Docs, on althar/docs.', 'Docs ship apart.', 'coordinator'],
          ['New change · Notes, on althar/notes.', null, 'lead'],
        ],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('reviews a related pull request named by its number, once', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const reviewed = colleagues(working, bare, github, 'back-off')
      assert.include(
        yield* callTool(task.lead, 'add_part', { part: 'reviewing', pull_request: reviewed.number, why: 'It touches the retry.' }),
        `${task.slug} reviews PR #${reviewed.number} now, beside its own work: a read-only copy of its head is in `,
      )
      // Asked again, by its number, it is the same review.
      assert.match(
        yield* callTool(task.lead, 'add_review', { pull_request: reviewed.number }),
        new RegExp(`^${task.slug} reviews PR #${reviewed.number} already: its copy is in .+\\.$`),
      )
      assert.deepStrictEqual(
        (yield* workspacesOf(task.taskId)).map((one) => one.reviewing),
        [null, reviewed.url],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('follows the pull request its branch is on, named by its number, as a change of its own', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const pull = opensByHand(task.worktree, bare, github, task.branch)
      assert.strictEqual(
        yield* callTool(task.lead, 'add_part', { part: 'output', pull_request: ` #${pull.number} `, why: 'Its fix goes there.' }),
        `${task.slug} follows #${pull.number} now, as a change of its own.`,
      )
      assert.deepStrictEqual(yield* followed(task.taskId), [{ url: pull.url, listening: 1 }])
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('changing a part', () => {
  it.live('puts a task on Scratch from add_part, and back on the board from change_part or remove_part', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      assert.strictEqual(
        yield* callTool(task.lead, 'add_part', { part: 'shelf', shelf: 'scratch', why: 'Only talking now.' }),
        `${task.slug} is on Scratch now.`,
      )
      assert.strictEqual(yield* shelfOf(task.taskId), 'scratch')
      assert.strictEqual(
        yield* callTool(task.lead, 'change_part', { part: 'shelf', shelf: 'board', why: 'Writing again.' }),
        `${task.slug} is on the board now.`,
      )
      assert.isNull(yield* shelfOf(task.taskId))
      yield* callTool(task.lead, 'change_part', { part: 'shelf', shelf: 'scratch', why: 'Only talking now.' })
      assert.strictEqual(
        yield* callTool(task.lead, 'remove_part', { part: 'shelf', why: 'Writing again.' }),
        `${task.slug} is on the board now.`,
      )
      assert.isNull(yield* shelfOf(task.taskId))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('asks where a workspace moves, and leaves one working toward its branch already as it is', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      assert.strictEqual(
        yield* callTool(task.lead, 'change_part', { part: 'workspace', why: 'Elsewhere.' }),
        'Say where it moves (to: worktree or checkout), or what it works toward (toward).',
      )
      assert.strictEqual(
        yield* callTool(task.lead, 'change_part', { part: 'workspace', toward: null, why: 'The default branch.' }),
        `${task.slug} works toward that already: nothing changed.`,
      )
      assert.strictEqual(
        yield* callTool(task.lead, 'change_part', { part: 'access', why: 'Run it.' }),
        'Running an outside author’s code is the person’s word alone (Run it). Suggest it to them.',
      )
      assert.isNull((yield* workspacesOf(task.taskId))[0]?.toward ?? null)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('moves a task Local and back, and waits while the person’s checkout has changes of theirs', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const move = (to: 'worktree' | 'checkout') => callTool(task.lead, 'change_part', { part: 'workspace', to, why: 'To try it.' })
      assert.strictEqual(yield* move('checkout'), `${task.slug} works Local, in the person’s checkout now; its lead starts afresh there.`)
      assert.strictEqual((yield* workspacesOf(task.taskId))[0]?.kind, 'checkout')
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), task.branch)
      assert.strictEqual(yield* move('worktree'), `${task.slug} works in a worktree of its own now; its lead starts afresh there.`)
      assert.isNull((yield* workspacesOf(task.taskId))[0]?.kind ?? null)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
      // The person's file, not committed, holds the move out, and is never touched.
      writeFileSync(join(working, 'Board.tsx'), 'export {}\n')
      assert.strictEqual(
        yield* move('checkout'),
        `${task.slug} moves once it can: Moves to Local once Board.tsx is committed in ${basename(working)}’s checkout.`,
      )
      assert.isNull((yield* workspacesOf(task.taskId))[0]?.kind ?? null)
      assert.strictEqual(git(working, 'status', '--porcelain'), '?? Board.tsx')
      // The task's header says the move waits, and why.
      assert.deepStrictEqual((yield* (yield* Queries).thread(task.threadId)).task.moving, {
        to: 'checkout',
        why: `Moves to Local once Board.tsx is committed in ${basename(working)}’s checkout.`,
      })
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('asks the person before taking their checkout off a branch of their own', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      git(working, 'switch', '-q', '-c', 'my-spike')
      assert.strictEqual(
        yield* callTool(task.lead, 'change_part', { part: 'workspace', to: 'checkout', why: 'To try it.' }),
        "The person’s checkout is on my-spike, a branch of theirs: they answer from the task's header whether to switch it.",
      )
      assert.isNull((yield* workspacesOf(task.taskId))[0]?.kind ?? null)
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'my-spike')
      // The task's header asks it, for the checkout as it was seen.
      assert.deepStrictEqual((yield* (yield* Queries).thread(task.threadId)).task.moving, {
        to: 'checkout',
        why: `${basename(working)}’s checkout is on my-spike, a branch of yours: switch it to ${task.branch}, or stay in the worktree?`,
        seen: { branch: 'my-spike', head: git(working, 'rev-parse', 'HEAD') },
      })
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('removing a part', () => {
  it.live('keeps a review whose draft was never posted, and lets it go once it is', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const reviewed = colleagues(working, bare, github, 'back-off')
      yield* callTool(task.lead, 'add_review', { pull_request: `#${reviewed.number}` })
      yield* callTool(task.lead, 'draft_review', { verdict: 'comment', summary: 'The backoff matches the retry.' })
      const remove = (args: Record<string, unknown>) => callTool(task.lead, 'remove_part', { part: 'reviewing', why: 'Done.', ...args })
      assert.strictEqual(
        yield* remove({ pull_request: `#${reviewed.number}` }),
        `${task.slug}'s draft review was never posted: removing it would lose it. Ask the person to post or discard it first.`,
      )
      const reviewing = () => Effect.map(workspacesOf(task.taskId), (all) => all.filter((one) => one.reviewing !== null))
      assert.strictEqual((yield* reviewing())[0]?.state, 'ready')
      // Posted, its copy goes, and the review stays.
      const sql = yield* SqlClient.SqlClient
      const [draft] = yield* sql<{ id: string }>`SELECT id FROM review_drafts WHERE task_id = ${task.taskId}`
      yield* (yield* Reviews).post(draft?.id ?? '', (yield* Instance).personId)
      assert.strictEqual(
        yield* remove({ pull_request: `#${reviewed.number}` }),
        `${task.slug} reviews that pull request no more: its thread, and any posted review, stay.`,
      )
      assert.strictEqual((yield* reviewing())[0]?.state, 'cleaned')
      // Named or not, it says the same of the reviews it has none of now.
      assert.strictEqual(yield* remove({}), `${task.slug} reviews that pull request no more: its thread, and any posted review, stay.`)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('stops following a pull request named by its link, asks for one, and never takes away Access', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const pull = opensByHand(task.worktree, bare, github, task.branch)
      yield* callTool(task.lead, 'add_part', { part: 'output', pull_request: pull.number, why: 'Its fix goes there.' })
      const remove = (args: Record<string, unknown>) => callTool(task.lead, 'remove_part', { why: 'Not ours.', ...args })
      assert.strictEqual(yield* remove({ part: 'output' }), 'Name the pull request: pull_request.')
      assert.strictEqual(yield* remove({ part: 'access' }), 'Access isn’t removed: the person says Run it, or stops it.')
      assert.deepStrictEqual(yield* followed(task.taskId), [{ url: pull.url, listening: 1 }])
      assert.strictEqual(
        yield* remove({ part: 'output', pull_request: pull.url }),
        `${task.slug} no longer follows ${pull.url}: its reviews, comments and checks aren't heard any more. attach_pull_request follows it again.`,
      )
      assert.deepStrictEqual(yield* followed(task.taskId), [{ url: pull.url, listening: 0 }])
      // By its number too, as add_part takes it; one it doesn't follow is said, and nothing changes.
      assert.strictEqual(
        yield* remove({ part: 'output', pull_request: `#${pull.number}` }),
        `${task.slug} doesn't follow #${pull.number}: nothing changed.`,
      )
      yield* callTool(task.lead, 'add_part', { part: 'output', pull_request: pull.number, why: 'Its fix goes there after all.' })
      assert.deepStrictEqual(yield* followed(task.taskId), [{ url: pull.url, listening: 1 }])
      assert.match(
        yield* remove({ part: 'output', pull_request: `#${pull.number}` }),
        new RegExp(`^${task.slug} no longer follows #${pull.number}:`),
      )
      assert.deepStrictEqual(yield* followed(task.taskId), [{ url: pull.url, listening: 0 }])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('follows no pull request its branch isn’t based on, saying what starting from its head keeps', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      // Someone's pull request from a branch of its own, which the task's branch has nothing of.
      git(working, 'switch', '-q', '-c', 'elsewhere')
      writeFileSync(join(working, 'elsewhere.txt'), 'elsewhere\n')
      git(working, 'add', 'elsewhere.txt')
      git(working, '-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', 'commit', '-q', '-m', 'Elsewhere')
      const pull = opensByHand(working, bare, github, 'elsewhere')
      git(working, 'switch', '-q', 'main')
      assert.match(
        yield* callTool(task.lead, 'add_part', { part: 'output', pull_request: pull.number, why: 'Its fix goes there.' }),
        new RegExp(`^Nothing changed yet: ${task.slug}'s branch isn't based on .+'s head\\. Starting it from there`),
      )
      assert.deepStrictEqual(yield* followed(task.taskId), [])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('takes this round’s review away, saying one under way stops and what it found stays', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      assert.strictEqual(
        yield* callTool(task.coordinator, 'remove_part', { task: task.slug, part: 'checked_by', why: 'The person skips it.' }),
        `${task.slug} has no review this round: one under way stops, findings filed already stay in its thread.`,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('starting another change', () => {
  it.live('refuses one with no name, in a repository the task hasn’t, or on a branch one of its changes is on', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const start = (args: Record<string, unknown>) => callTool(task.lead, 'start_change', args)
      const name = basename(working)
      assert.strictEqual(
        yield* start({ name: '  ' }),
        `Nothing changed for ${task.slug}: A change needs a name: a few words for what it does.`,
      )
      assert.strictEqual(
        yield* start({ name: 'Docs', repository: 'web' }),
        `Nothing changed for ${task.slug}: The task has no repository called web: ${name}.`,
      )
      // An empty repository is the task's first; its own is found by its name, whatever its case.
      assert.include(yield* start({ name: 'Docs', repository: '' }), '“Docs”: its worktree is')
      assert.include(yield* start({ name: 'Notes', repository: name.toUpperCase(), branch: 'notes' }), ', on notes, working toward main.')
      assert.strictEqual(
        yield* start({ name: 'Notes again', branch: 'notes' }),
        `Nothing changed for ${task.slug}: A change of the task is on notes already.`,
      )
      assert.deepStrictEqual(
        (yield* workspacesOf(task.taskId)).map((one) => [one.name, one.branch]),
        [
          [null, task.branch],
          ['Docs', 'althar/docs'],
          ['Notes', 'notes'],
        ],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('works toward another branch only where it is there, and waits for another change by its name, not stacked on it too', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      const name = basename(working)
      git(working, 'branch', 'release/0.8.0')
      const start = (args: Record<string, unknown>) => callTool(task.lead, 'start_change', args)
      assert.strictEqual(
        yield* start({ name: 'Backport', toward: 'release/9.9.9' }),
        `Nothing changed for ${task.slug}: ${name} has no branch release/9.9.9, on its remote or here.`,
      )
      assert.include(yield* start({ name: 'Backport', toward: 'release/0.8.0' }), ', on althar/backport, working toward release/0.8.0.')
      yield* start({ name: 'Fix main' })
      assert.strictEqual(
        yield* start({ name: 'Release notes', waits_for: 'Nothing' }),
        `Nothing changed for ${task.slug}: The task has no change “Nothing” in ${name} to wait for.`,
      )
      assert.strictEqual(
        yield* start({ name: 'Release notes', waits_for: 'Fix main', on: 'Fix main' }),
        `Nothing changed for ${task.slug}: A change either stacks on another or waits for it: not both.`,
      )
      // By its name, whatever its case.
      assert.include(yield* start({ name: 'Release notes', waits_for: 'fix MAIN' }), '“Release notes”')
      const all = yield* workspacesOf(task.taskId)
      assert.strictEqual(all.find((one) => one.name === 'Backport')?.toward, 'release/0.8.0')
      assert.strictEqual(all.find((one) => one.name === 'Release notes')?.waitsFor, all.find((one) => one.name === 'Fix main')?.id)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('tells the task’s lead where a change someone else started is, and why', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      yield* callTool(task.coordinator, 'start_change', { task: task.slug, name: 'Docs', why: 'They ship apart.' })
      const sql = yield* SqlClient.SqlClient
      const told = yield* until(
        sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${task.threadId}`,
        (rows) => rows.length > 0,
      )
      assert.match(
        told[0]?.body ?? '',
        /^A new change of this task, “Docs”, is in .*, on althar\/docs, working toward main\. Commit its work there; it ships and is reviewed on its own\. Why: They ship apart\.$/,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task’s other buttons', () => {
  it.live('keeps one change together with another it names, and ships none of them with nothing waiting', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      yield* callTool(task.lead, 'start_change', { name: 'Notes' })
      assert.strictEqual(
        yield* callTool(task.lead, 'join_changes', { change: 'Notes', into: 'Docs' }),
        "Kept “Notes” together with “Docs”: its commits are on that change's branch, its folder went, and its branch stays.",
      )
      assert.deepStrictEqual(
        (yield* workspacesOf(task.taskId)).map((one) => [one.name, one.state]),
        [
          [null, 'ready'],
          ['Docs', 'ready'],
          ['Notes', 'cleaned'],
        ],
      )
      assert.strictEqual(
        yield* callTool(task.coordinator, 'ship_task', { task: task.slug, change: 'Docs' }),
        'Nothing was done: Nothing waits to ship.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('says no review after a merge waits, whether asked to fix what it found or leave it', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* aTask(working)
      for (const answer of ['fix', 'leave'])
        assert.strictEqual(
          yield* callTool(task.coordinator, 'answer_review_after_merge', { task: task.slug, answer, why: 'The person said so.' }),
          `Nothing changed for ${task.slug}: No review after a merge waits on you here.`,
        )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
