import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { BUILT, BUILT_SETTLED, DESCRIBED } from '@althar/provider-adapters/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from '../src/Artifacts'
import { Changes } from '../src/Changes'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { HOST, hosted, items, repository, until } from './support'

import { runtimeWith, connect, ask, cards, git } from './changesSupport'

/*
 * A task that ends in a pull request (docs/plans/integrations.md): when its
 * steps are done, Althar commits what the lead left, pushes the branch to
 * the code host (here, a bare repository in its place), and opens a draft
 * pull request on it (here, the fake service); then it listens. What people
 * say arrives in the thread and reaches the lead; failed checks too; a merge
 * settles the task.
 */

describe('a task that ends in a pull request', () => {
  it.live('works a task’s ending out once, as the project says, else by its host, and on its branch where no host is known', () => {
    const { working } = hosted()
    const github = makeFakeService({ pushUrl: () => working })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const changes = yield* Changes
      const instance = yield* Instance
      const onHost = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const local = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      // Before it is connected, github.test is no host Althar knows: the branch, whatever the project asks.
      yield* policies.set(onHost.projectId, { end: 'ready' }, instance.personId)
      assert.isNull(yield* changes.endFor(onHost.projectId))
      yield* connect('github', HOST)
      assert.strictEqual(yield* changes.endFor(onHost.projectId), 'ready')
      yield* policies.set(onHost.projectId, { end: null }, instance.personId)
      assert.strictEqual(yield* changes.endFor(onHost.projectId), 'draft')
      yield* policies.set(onHost.projectId, { end: 'none' }, instance.personId)
      assert.strictEqual(yield* changes.endFor(onHost.projectId), 'none')
      // No host Althar knows: a project that wants a pull request still ends on the branch, as it always has.
      yield* policies.set(local.projectId, { end: 'ready' }, instance.personId)
      assert.isNull(yield* changes.endFor(local.projectId))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('ends as the project says where the plan doesn’t: its branch alone, though the host is connected', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projects = yield* Projects
      const plans = yield* Plans
      const policies = yield* Policies
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      yield* policies.set(project.projectId, { end: 'none' }, instance.personId)
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Push it',
        description: '[lead:finish] [lead:edit]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: null,
      })
      yield* plans.start(planId, instance.personId)
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.lengthOf(github.changes, 0)
      assert.include(git(bare, 'ls-tree', '--name-only', created.branch), 'change.txt')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('asks the person when it can’t reach the host, and carries on once it can', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const runs = yield* Runs
      const instance = yield* Instance
      const queries = yield* Queries
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Add a retry',
        description: '[lead:finish] [lead:edit]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        startsIn: Duration.zero,
        end: 'draft',
      })
      yield* plans.start(planId, instance.personId)
      // Nothing reaches the repository's host: the step waits on the person.
      const [call] = yield* until(
        Effect.map(queries.thread(created.threadId), (snapshot) => snapshot.attention),
        (attention) => attention.length === 1,
        Duration.seconds(20),
      )
      assert.deepInclude(call?.stuck, { step: 'publish', why: 'not_connected' })
      // Meanwhile something is left in the worktree: Althar doesn't commit it, and says so.
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
      writeFileSync(join(workspace?.path ?? '', 'notes.txt'), 'later\n')
      // Connected, and asked to try again, it opens the pull request.
      yield* connect('github', HOST)
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'retry', agentId: 'claude-code' },
      })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.strictEqual(ready?.change?.number, 1)
      const published = (yield* items(ready?.threadId ?? '')).find((item) => item.kind === 'step_result' && item.content.step === 'publish')
      assert.strictEqual(published?.content.summary, "Opened draft pull request #1. Left out what the lead didn't commit: `notes.txt`.")
      assert.notInclude(git(bare, 'ls-tree', '--name-only', created.branch), 'notes.txt')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('asks the person to sign in again, not to connect, when the host’s sign-in is lost, and carries on once they have', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const runs = yield* Runs
      const instance = yield* Instance
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      // Connected, until the keychain lost the token and the connection said it needs signing in again.
      const connection = yield* connect('github', HOST)
      yield* sql`UPDATE connections SET state = 'reauth_required' WHERE id = ${connection.id}`
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Add a retry',
        description: '[lead:finish] [lead:edit]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        startsIn: Duration.zero,
        end: 'draft',
      })
      yield* plans.start(planId, instance.personId)
      const [call] = yield* until(
        Effect.map(queries.thread(created.threadId), (snapshot) => snapshot.attention),
        (attention) => attention.length === 1,
        Duration.seconds(20),
      )
      // It says the sign-in is lost, in the words for a refused one, not that nothing is connected, nor an error's name.
      assert.deepInclude(call?.stuck, {
        step: 'publish',
        why: 'failed_to_start',
        detail: "GitHub no longer takes Althar's sign-in. Sign in to it again.",
      })
      // Signed in again, and asked to try again, it opens the pull request.
      yield* connect('github', HOST)
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'retry', agentId: 'claude-code' },
      })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.strictEqual(ready?.change?.number, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'asks to sign in again for a fork’s branch too, and once they have, pushes it to the fork and opens the pull request upstream',
    () => {
      const { working, bare } = hosted(['you', 'api'])
      git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
      const pushedTo: Array<string> = []
      const github = makeFakeService({
        pushUrl: (path) => {
          pushedTo.push(path.join('/'))
          return bare
        },
      })
      github.addRepository(['you', 'api'])
      github.addRepository(['meridian', 'api'], 'trunk')
      return Effect.gen(function* () {
        const projects = yield* Projects
        const plans = yield* Plans
        const runs = yield* Runs
        const instance = yield* Instance
        const queries = yield* Queries
        const sql = yield* SqlClient.SqlClient
        // Connected, until the keychain lost the token and the connection said it needs signing in again.
        const connection = yield* connect('github', HOST)
        yield* sql`UPDATE connections SET state = 'reauth_required' WHERE id = ${connection.id}`
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        const [repository] = yield* projects.repositories(project.projectId)
        yield* projects.setRepository({ projectId: project.projectId, repositoryId: repository?.id ?? '', changeTarget: 'upstream' })
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Add a retry',
          description: '[lead:finish] [lead:edit]',
          draft: true,
        })
        const planId = yield* plans.propose({
          projectId: project.projectId as ProjectId,
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
          reason: null,
          actorId: instance.personId,
          startsIn: Duration.zero,
          end: 'draft',
        })
        yield* plans.start(planId, instance.personId)
        const [call] = yield* until(
          Effect.map(queries.thread(created.threadId), (snapshot) => snapshot.attention),
          (attention) => attention.length === 1,
          Duration.seconds(20),
        )
        // It says the sign-in is lost, in the words for a refused one, not that nothing is connected, nor an error's name.
        assert.deepInclude(call?.stuck, {
          step: 'publish',
          why: 'failed_to_start',
          detail: "GitHub no longer takes Althar's sign-in. Sign in to it again.",
        })
        // Signed in again, and asked to try again, it opens the pull request.
        yield* connect('github', HOST)
        yield* runs.answerStuck({
          envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
          attentionId: call?.id ?? '',
          answer: { kind: 'retry', agentId: 'claude-code' },
        })
        const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
        assert.strictEqual(ready?.change?.url, 'https://github.com/meridian/api/pull/1')
        assert.strictEqual(github.forkOf(1), 'you/api')
        assert.strictEqual(github.changes[0]?.target, 'trunk')
        // Nothing was pushed while the sign-in was lost.
        assert.deepStrictEqual(pushedTo, ['you/api'])
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
  )

  it.live('asks the lead to commit or clear away what it left, before its step is done', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:scratch]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      // Told its scratch file wasn't committed, the lead deleted it; what was pushed is what it committed, and nothing was left out.
      const published = (yield* items(ready?.threadId ?? '')).find((item) => item.kind === 'step_result' && item.content.step === 'publish')
      assert.strictEqual(published?.content.summary, 'Opened draft pull request #1.')
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ path: string; branch: string }>`SELECT path, branch FROM workspaces`
      assert.isFalse(existsSync(join(workspace?.path ?? '', 'scratch.log')))
      assert.deepStrictEqual(git(bare, 'ls-tree', '--name-only', workspace?.branch ?? '').split('\n'), ['README.md', 'change.txt'])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('keeps the evidence the lead hands, its screenshot uncommitted, and describes it in the pull request', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:evidence]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const queries = yield* Queries
      const thread = yield* queries.thread(ready?.threadId ?? '')
      const implement = thread.items.find((item) => item.kind === 'step_result' && item.content.step === 'implement')
      assert(implement?.kind === 'step_result')
      const [shot, tests] = implement.content.evidence
      // The screenshot is kept as a picture an agent hands back is: by its digest, in the store.
      assert.strictEqual(shot?.kind, 'screenshot')
      assert.strictEqual(shot?.caption, 'The retry button after a failed checkout')
      assert.match(shot?.picture?.digest ?? '', /^[0-9a-f]{64}$/)
      assert.deepStrictEqual([shot?.picture?.width, shot?.picture?.height], [480, 300])
      assert.isNotNull(yield* (yield* Artifacts).read(shot?.picture?.digest ?? ''))
      assert.deepStrictEqual(tests, {
        kind: 'test_run',
        caption: 'The checkout tests',
        picture: null,
        command: 'bun test checkout',
        exit: 0,
        text: 'checkout.test.ts\n  ✓ retries once\n\n1 passed\n',
        dropped: 0,
      })
      assert.deepStrictEqual(implement.content.unverified, ['Not tried against the real payment provider: no sandbox account'])
      // Its screenshot needn't be committed, isn't pushed, and isn't part of what the task changed.
      assert.deepStrictEqual(
        thread.task.files.map((file) => file.path),
        ['change.txt'],
      )
      const published = thread.items.find((item) => item.kind === 'step_result' && item.content.step === 'publish')
      assert.strictEqual(published?.kind === 'step_result' ? published.content.summary : null, 'Opened draft pull request #1.')
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{ branch: string }>`SELECT branch FROM workspaces`
      assert.deepStrictEqual(git(bare, 'ls-tree', '--name-only', workspace?.branch ?? '').split('\n'), ['README.md', 'change.txt'])
      // The evidence is the person's, in Althar: the pull request is described as the lead wrote it, with none of it.
      assert.strictEqual(github.changes[0]?.body, `${DESCRIBED}\n\nOpened by [Althar](https://github.com/AltharIDE/althar).`)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('lets the reviewer read the evidence, and keeps it across settling, which needn’t hand the screenshot again', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [lead:evidence] [lead:set-aside] [review:findings] [review:evidence]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(30))
      const all = yield* items(ready?.threadId ?? '')
      const results = all.flatMap((item) => (item.kind === 'step_result' ? [item.content] : []))
      // The reviewer read the screenshot, which isn't in its copy, and the run's output, each from where its brief said.
      const review = results.find((result) => result.step === 'review')
      assert.match(String(review?.summary), / Read: 1-retry\.png \(\d+ bytes\), 2-test_run\.txt \(\d+ bytes\)\./)
      // Settling, the lead handed a new run and an empty list of what it couldn't show, not its screenshot again: Althar took it.
      const settled = results.find((result) => result.step === 'settle')
      assert.deepStrictEqual(settled?.unverified, [])
      assert.strictEqual(results.find((result) => result.step === 'publish')?.summary, 'Opened draft pull request #1.')
      // The pull request has none of what it showed, settling or not.
      const body = github.changes[0]?.body ?? ''
      assert.isTrue(body.startsWith(DESCRIBED))
      assert.notInclude(body, 'The heading test')
      assert.notInclude(body, 'exit 0')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'says what the task built as it ended, a settling that changed the work saying it again, and keeps it out of the description',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        yield* connect('github', HOST)
        // Settling commits a fix but leaves what it built unsaid, until Althar asks for it again.
        const projectId = yield* ask(
          working,
          'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [lead:built-unsaid] [review:findings]',
        )
        const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(30))
        const results = (yield* items(ready?.threadId ?? '')).flatMap((item) => (item.kind === 'step_result' ? [item.content] : []))
        assert.deepStrictEqual(
          results.map((result) => [result.step, result.built ?? null]),
          [
            ['implement', BUILT],
            ['review', null],
            ['settle', BUILT_SETTLED],
            ['review', null],
            ['publish', null],
          ],
        )
        // That is the person's; the pull request has the description the lead wrote for its reviewer.
        const body = github.changes[0]?.body ?? ''
        assert.isTrue(body.startsWith(DESCRIBED))
        assert.notInclude(body, BUILT_SETTLED)
        assert.notInclude(body, BUILT)
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
  )

  it.live(
    'gives a reviewer carrying on to another round the evidence the lead handed settling',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        yield* connect('github', HOST)
        // Settling commits a fix, so the review looks again, in the same session.
        const projectId = yield* ask(
          working,
          'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [lead:evidence] [review:findings] [review:evidence]',
        )
        const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(30))
        const reviews = (yield* items(ready?.threadId ?? '')).flatMap((item) =>
          item.kind === 'step_result' && item.content.step === 'review' ? [String(item.content.summary)] : [],
        )
        assert.lengthOf(reviews, 2)
        assert.notInclude(reviews[0] ?? '', '3-test_run')
        // The second round read the run the lead handed settling, written out for it then.
        assert.match(reviews[1] ?? '', / Read: 1-retry\.png \(\d+ bytes\), 2-test_run\.txt \(\d+ bytes\), 3-test_run\.txt \(\d+ bytes\)\./)
        const sql = yield* SqlClient.SqlClient
        const [sessions] = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.kind = 'step' AND t.node_key = 'review'`
        assert.strictEqual(sessions?.n, 1)
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
    60_000,
  )

  it.live('goes on without its pull request when the person says so', () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const runs = yield* Runs
      const instance = yield* Instance
      const queries = yield* Queries
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Add a retry',
        description: '[lead:finish] [lead:edit]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        startsIn: Duration.zero,
        end: 'draft',
      })
      yield* plans.start(planId, instance.personId)
      const [call] = yield* until(
        Effect.map(queries.thread(created.threadId), (snapshot) => snapshot.attention),
        (attention) => attention.length === 1,
        Duration.seconds(20),
      )
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(10))
      assert.isNull(ready?.change)
    }).pipe(Effect.provide(runtimeWith({})))
  })
})
