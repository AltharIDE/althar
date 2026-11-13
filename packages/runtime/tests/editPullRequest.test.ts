import { execFileSync } from 'node:child_process'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, turnsFor, until } from './support'

/*
 * A task's pull request and its title and description after it opened: the
 * lead's edit_pull_request, by the project's naming, the task's card
 * following; the person's or the coordinator's rename of the task, its pull
 * request following; a lead's later description reaching it; the
 * coordinator's edit_pull_request on any it may change; and a host that
 * says no, in its words, with nothing changed.
 */

const CREDIT = 'Opened by [Althar](https://github.com/AltharIDE/althar).'

/** Listening waits an hour, so nothing but what the test does asks the fake meanwhile. */
const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const tipOf = (bare: string) => () => {
  try {
    return execFileSync('git', ['rev-parse', 'althar/add-a-retry'], { cwd: bare }).toString().trim()
  } catch {
    return null
  }
}

/** A task whose pull request is open and whose card is ready: its lead's access to its tools, and the coordinator's. */
const withPullRequest = (working: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const coordinator = yield* Coordinator
    const queries = yield* Queries
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const cards = Effect.map(queries.coordinator(project.projectId), (snapshot) =>
      snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
    )
    const [ready] = yield* until(cards, (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
    const taskId = ready?.taskId ?? ''
    const access = (role: 'lead' | 'coordinator'): ToolAccess => ({
      role,
      projectId: project.projectId as ProjectId,
      threadId: role === 'lead' ? (ready?.threadId ?? '') : threadId,
      sessionId: 'none',
      taskId: role === 'lead' ? taskId : null,
    })
    return {
      lead: access('lead'),
      coordinator: access('coordinator'),
      taskId,
      projectId: project.projectId,
      leadThread: ready?.threadId ?? '',
    }
  })

/** As `withPullRequest`, with the slug of the task's repository, which a lead's descriptions go by. */
const withSlug = (working: string) =>
  Effect.gen(function* () {
    const made = yield* withPullRequest(working)
    const sql = yield* SqlClient.SqlClient
    const [binding] = yield* sql<{ slug: string }>`
      SELECT b.slug FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${made.taskId}`
    return { ...made, lead: { ...made.lead, coordinatorAccess: made.coordinator }, slug: binding?.slug ?? '' }
  })

const titleOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${taskId}`
    return task?.title ?? ''
  })

/** The task came from an issue on another tracker, whose key the project's naming puts in front of its pull request's title. */
const fromIssue = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const at = new Date().toISOString()
    yield* sql`INSERT INTO external_links ${sql.insert({
      id: 'xlink_a5500000000000000000000000000000',
      projectId,
      taskId,
      connectionId: null,
      product: 'linear',
      kind: 'issue',
      externalId: 'MER-231',
      ref: 'MER-231',
      key: 'MER-231',
      url: 'https://linear.app/meridian/issue/MER-231',
      snapshot: '{}',
      createdAt: at,
      updatedAt: at,
    })}`
  })

const seeded = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
  github.addRepository(['meridian', 'api'])
  return { working, github }
}

describe('a lead’s edit_pull_request', () => {
  it.live('retitles its pull request by the project’s naming, without an agent’s credit, and the task’s card follows', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { lead, taskId, projectId } = yield* withPullRequest(working)
      yield* fromIssue(projectId, taskId)
      // The words alone: the key it gave is the naming's to put in front, and a credit line goes.
      const said = yield* callTool(lead, 'edit_pull_request', {
        title: 'MER-231: The homepage opens on the orrery\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      })
      assert.strictEqual(
        said,
        "PR #1 is called “MER-231: The homepage opens on the orrery” now. The task's card says “The homepage opens on the orrery”.",
      )
      assert.strictEqual(github.changes[0]?.title, 'MER-231: The homepage opens on the orrery')
      assert.strictEqual(yield* titleOf(taskId), 'The homepage opens on the orrery')
      // Asked again, nothing changes on the host.
      const edits = github.calls.filter((call) => call === 'editChange').length
      assert.include(yield* callTool(lead, 'edit_pull_request', { title: 'The homepage opens on the orrery' }), 'already')
      assert.strictEqual(github.calls.filter((call) => call === 'editChange').length, edits)
      // Too long for the card, or nothing but credit, is refused.
      assert.include(yield* callTool(lead, 'edit_pull_request', { title: 'x'.repeat(61) }), 'Keep it to 60')
      assert.include(
        yield* callTool(lead, 'edit_pull_request', { title: 'Co-Authored-By: Claude <noreply@anthropic.com>' }),
        'Give it a title',
      )
      assert.include(yield* callTool(lead, 'edit_pull_request', {}), 'Give a title, a description, or both.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('sets its description, keeping the line Althar put after it, and the agents’ credit goes', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { lead } = yield* withPullRequest(working)
      assert.isTrue(github.changes[0]?.body.endsWith(CREDIT))
      const said = yield* callTool(lead, 'edit_pull_request', {
        description: 'The homepage opens on the orrery.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      })
      assert.strictEqual(said, 'PR #1 has the new description.')
      assert.strictEqual(github.changes[0]?.body, `The homepage opens on the orrery.\n\n${CREDIT}`)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('passes on a host’s refusal in its words, the pull request and the task’s card as they were', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { lead, taskId } = yield* withPullRequest(working)
      const before = { title: github.changes[0]?.title, task: yield* titleOf(taskId) }
      github.failNext('editChange', 'forbidden', undefined, 403)
      const said = yield* callTool(lead, 'edit_pull_request', { title: 'The homepage opens on the orrery' })
      assert.include(said, "GitHub wouldn't change PR #1: The fake editChange failed (forbidden).")
      assert.include(said, 'Tell the person what you would set')
      assert.strictEqual(github.changes[0]?.title, before.title)
      assert.strictEqual(yield* titleOf(taskId), before.task)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('says it couldn’t tell where the host’s answer was lost, rather than that nothing changed', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { lead, taskId } = yield* withPullRequest(working)
      const before = yield* titleOf(taskId)
      github.failNext('editChange', 'unreachable')
      const said = yield* callTool(lead, 'edit_pull_request', { title: 'The homepage opens on the orrery' })
      assert.include(said, "Althar couldn't tell whether GitHub changed PR #1")
      assert.include(said, 'Read it with read_pull_request before saying it changed or didn')
      assert.notInclude(said, 'stay as they were')
      assert.strictEqual(yield* titleOf(taskId), before)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live(
    'edits any of the project’s pull requests it names, an outside author’s on the person’s word, and leaves another’s task as it is',
    () => {
      const { working, github } = seeded()
      return Effect.gen(function* () {
        const { lead: bare, taskId } = yield* withPullRequest(working)
        const { access: lead, turn } = yield* turnsFor(bare)
        const before = yield* titleOf(taskId)
        // One of the repository's people's, no task's: as given, the task's own card as it was.
        const member = github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana' })
        assert.include(
          yield* callTool(lead, 'edit_pull_request', { pull_request: `#${member.number}`, title: 'Fix the retry' }),
          `PR #${member.number} is called “Fix the retry” now, where it was “Their fix”.`,
        )
        assert.strictEqual(yield* titleOf(taskId), before)
        // An outside author's: on the person's word only.
        const outside = github.addPullRequest({ path: ['meridian', 'api'], title: 'Drive-by', author: 'stranger', member: false })
        assert.include(
          yield* callTool(lead, 'edit_pull_request', { pull_request: `#${outside.number}`, title: 'Renamed' }),
          'an outside author’s, so it goes on the person’s word',
        )
        assert.strictEqual(github.changes.find((change) => change.number === outside.number)?.title, 'Drive-by')
        const asked = yield* turn(`Retitle #${outside.number} to Renamed.`)
        assert.include(
          yield* callTool(lead, 'edit_pull_request', { pull_request: `#${outside.number}`, title: 'Renamed', message: asked }),
          'is called “Renamed” now',
        )
        // And it replies on any, as the coordinator does.
        assert.include(
          yield* callTool(lead, 'reply_on_pull_request', { pull_request: `#${member.number}`, body: 'Looks right.' }),
          `Replied on PR #${member.number}`,
        )
        // Named as its own, it goes ahead as its own.
        assert.include(
          yield* callTool(lead, 'edit_pull_request', { pull_request: '#1', title: 'Retry twice' }),
          'is called “Retry twice” now',
        )
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )
})

describe('a task renamed, its pull request following', () => {
  for (const role of ['lead', 'coordinator'] as const) {
    it.live(`reminds the ${role} to retitle reshaped work, and its rename updates the open pull request by the project's naming`, () => {
      const { working, github } = seeded()
      return Effect.gen(function* () {
        const made = yield* withPullRequest(working)
        const access = made[role]
        yield* fromIssue(made.projectId, made.taskId)
        yield* callTool(access, 'rename_task', { task_id: made.taskId, title: 'Prototype retry behavior' })
        const shaped = yield* callTool(access, 'change_part', {
          task: made.taskId,
          part: 'ending',
          end: 'ready',
          why: 'the person asked',
        })
        assert.include(shaped, 'current title, “Prototype retry behavior”')
        assert.include(shaped, 'call rename_task')
        assert.include(shaped, 'Keep it if it still fits')
        assert.strictEqual(yield* titleOf(made.taskId), 'Prototype retry behavior')
        const renamed = yield* callTool(access, 'rename_task', { task_id: made.taskId, title: 'Add configurable retries' })
        assert.include(renamed, 'PR #1 is called “MER-231: Add configurable retries” now.')
        assert.strictEqual(yield* titleOf(made.taskId), 'Add configurable retries')
        assert.strictEqual(github.changes[0]?.title, 'MER-231: Add configurable retries')
        assert.strictEqual(github.changes[0]?.source, 'althar/add-a-retry')
        assert.isFalse(github.changes[0]?.draft)
      }).pipe(Effect.provide(runtimeWith(github)))
    })
  }

  it.live('follows the person’s rename in the background, and the coordinator’s at once, saying so', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { coordinator, taskId } = yield* withPullRequest(working)
      yield* (yield* Tasks).rename({ envelope: yield* Runtime.envelope('task.rename', { taskId }), taskId, title: 'Retry twice' })
      yield* until(
        Effect.sync(() => github.changes[0]?.title),
        (title) => title === 'Retry twice',
      )
      const said = yield* callTool(coordinator, 'rename_task', { task_id: taskId, title: 'Retry three times' })
      assert.include(said, 'PR #1 is called “Retry three times” now.')
      assert.strictEqual(github.changes[0]?.title, 'Retry three times')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('says in the task’s thread when the host refused to follow the person’s rename', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { taskId, leadThread } = yield* withPullRequest(working)
      github.failNext('editChange', 'forbidden', undefined, 403)
      yield* (yield* Tasks).rename({ envelope: yield* Runtime.envelope('task.rename', { taskId }), taskId, title: 'Retry twice' })
      const notices = yield* until(
        Effect.map(items(leadThread), (all) =>
          all.filter((item) => item.kind === 'notice' && String(item.content.title).includes('kept its title')),
        ),
        (found) => found.length > 0,
      )
      assert.include(String(notices[0]?.content.title), 'PR #1 kept its title')
      assert.strictEqual(yield* titleOf(taskId), 'Retry twice')
      assert.notStrictEqual(github.changes[0]?.title, 'Retry twice')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a lead’s later description', () => {
  it.live('reaches its open pull request, and leaves one changed on the host since', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { taskId } = yield* withPullRequest(working)
      const sql = yield* SqlClient.SqlClient
      const [binding] = yield* sql<{ slug: string }>`
        SELECT b.slug FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${taskId}`
      const slug = binding?.slug ?? ''
      const changes = yield* Changes
      assert.deepStrictEqual(yield* changes.redescribe(taskId, { [slug]: 'Retries twice now.' }, null), ['PR #1 has your new description.'])
      assert.strictEqual(github.changes[0]?.body, `Retries twice now.\n\n${CREDIT}`)
      // Said again, nothing more goes up.
      assert.deepStrictEqual(yield* changes.redescribe(taskId, { [slug]: 'Retries twice now.' }, null), [])
      // Changed on GitHub since, it is the person's: left as it is, and the lead told how to set its own over it.
      github.editByHand(1, { body: 'Written by hand.' })
      const [left] = yield* changes.redescribe(taskId, { [slug]: 'Retries three times.' }, null)
      assert.include(left, 'was changed on GitHub since Althar set it')
      assert.strictEqual(github.changes[0]?.body, 'Written by hand.')
      // Another repository's description is none of this one's.
      assert.deepStrictEqual(yield* changes.redescribe(taskId, { web: 'Elsewhere.' }, null), [])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('isn’t set over the person’s description after Althar retitled the pull request alone', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { lead, taskId, slug } = yield* withSlug(working)
      github.editByHand(1, { body: 'Written by hand.' })
      // A title alone, by the lead or a rename: its answer carries the person's words, which aren't Althar's to replace.
      yield* callTool(lead, 'edit_pull_request', { title: 'Retry twice' })
      yield* callTool(lead.coordinatorAccess, 'rename_task', { task_id: taskId, title: 'Retry three times' })
      assert.strictEqual(github.changes[0]?.title, 'Retry three times')
      const [left] = yield* (yield* Changes).redescribe(taskId, { [slug]: 'Retries three times.' }, null)
      assert.include(left, 'was changed on GitHub since Althar set it')
      assert.strictEqual(github.changes[0]?.body, 'Written by hand.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('reaches it from finish_step, which says so', () => {
    const { working, github } = seeded()
    return Effect.gen(function* () {
      const { lead, leadThread } = yield* withSlug(working)
      // A turn after its plan, as the lead's own session gives a summary after its pull request opened: kept, opening nothing.
      const sql = yield* SqlClient.SqlClient
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${leadThread} ORDER BY started_at DESC LIMIT 1`
      const said = yield* callTool({ ...lead, sessionId: session?.id ?? '' }, 'finish_step', {
        summary: 'Cut it down.',
        built: 'Retries twice.',
        descriptions: [{ text: 'Retries twice now, and no more.' }],
      })
      assert.strictEqual(said, 'Althar has your summary. PR #1 has your new description.')
      assert.strictEqual(github.changes[0]?.body, `Retries twice now, and no more.\n\n${CREDIT}`)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('the coordinator’s edit_pull_request', () => {
  it.live(
    'edits a task’s pull request as its lead would, one a member opened as given, and an outside author’s on the person’s word',
    () => {
      const { working, github } = seeded()
      return Effect.gen(function* () {
        const { coordinator: bare, taskId, projectId } = yield* withPullRequest(working)
        const { access: coordinator, turn } = yield* turnsFor(bare)
        yield* fromIssue(projectId, taskId)
        // The task's: by the project's naming, the task's card following.
        const said = yield* callTool(coordinator, 'edit_pull_request', { pull_request: '#1', title: 'The homepage opens on the orrery' })
        assert.include(said, 'PR #1 is called “MER-231: The homepage opens on the orrery” now.')
        assert.strictEqual(yield* titleOf(taskId), 'The homepage opens on the orrery')
        // One of the repository's people's, no task's: as given, its own description replaced whole.
        const member = github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana', body: 'Old words.' })
        assert.strictEqual(
          yield* callTool(coordinator, 'edit_pull_request', {
            pull_request: `#${member.number}`,
            title: 'Fix the retry',
            description: 'New words.',
          }),
          `PR #${member.number} is called “Fix the retry” now, where it was “Their fix”. PR #${member.number} has the new description.`,
        )
        assert.deepInclude(
          github.changes.find((change) => change.number === member.number),
          { title: 'Fix the retry', body: 'New words.' },
        )
        // An outside author's goes on the person's word: unasked, nothing changes.
        const outside = github.addPullRequest({ path: ['meridian', 'api'], title: 'Drive-by', author: 'stranger', member: false })
        assert.include(
          yield* callTool(coordinator, 'edit_pull_request', { pull_request: `#${outside.number}`, title: 'Renamed' }),
          'an outside author’s, so it goes on the person’s word',
        )
        assert.strictEqual(github.changes.find((change) => change.number === outside.number)?.title, 'Drive-by')
        const asked = yield* turn(`Rename #${outside.number} to Renamed.`)
        assert.include(
          yield* callTool(coordinator, 'edit_pull_request', { pull_request: `#${outside.number}`, title: 'Renamed', message: asked }),
          'is called “Renamed” now',
        )
        assert.strictEqual(github.changes.find((change) => change.number === outside.number)?.title, 'Renamed')
        // A host that says no is passed on in its words.
        github.failNext('editChange', 'forbidden', undefined, 403)
        assert.include(
          yield* callTool(coordinator, 'edit_pull_request', { pull_request: `#${member.number}`, title: 'Again' }),
          "GitHub wouldn't change PR",
        )
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live(
    'leaves a closed one as it is, refuses a title that is only credit or a blank description, and says what it couldn’t tell',
    () => {
      const { working, github } = seeded()
      return Effect.gen(function* () {
        const { coordinator } = yield* withPullRequest(working)
        const edit = (number: number, args: Record<string, unknown>) =>
          callTool(coordinator, 'edit_pull_request', { pull_request: `#${number}`, ...args })
        const closed = github.addPullRequest({ path: ['meridian', 'api'], title: 'Gave up', author: 'dana', state: 'closed' })
        assert.strictEqual(
          yield* edit(closed.number, { title: 'Renamed' }),
          `PR #${closed.number} is closed, so its title and description stay as they are.`,
        )
        const member = github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana', body: 'Old words.' })
        const credit = 'Co-Authored-By: Claude <noreply@anthropic.com>'
        assert.include(yield* edit(member.number, { title: credit }), 'Give it a title')
        assert.include(yield* edit(member.number, { description: ' \n ' }), 'Say what the description should say.')
        // What it says already changes nothing on the host.
        const edits = github.calls.filter((call) => call === 'editChange').length
        assert.strictEqual(yield* edit(member.number, { title: 'Their fix' }), `PR #${member.number} says that already.`)
        assert.strictEqual(github.calls.filter((call) => call === 'editChange').length, edits)
        // A description alone, and only it is said.
        assert.strictEqual(yield* edit(member.number, { description: 'New words.' }), `PR #${member.number} has the new description.`)
        // An answer lost on the way: it can't say whether it changed.
        github.failNext('editChange', 'unreachable')
        assert.include(yield* edit(member.number, { title: 'Fix the retry' }), "Althar couldn't tell whether GitHub changed")
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )
})
