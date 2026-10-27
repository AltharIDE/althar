import { execFileSync } from 'node:child_process'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Tasks } from '../src/Tasks'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A change whose checks Althar sees through before the person has it
 * (ADR-041), where its host won't show them: the change is the person's,
 * said once; one the person has already is only said to be unread.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
  )

const tipOf = (bare: string) => () => {
  try {
    return execFileSync('git', ['rev-parse', 'althar/add-a-retry'], { cwd: bare }).toString().trim()
  } catch {
    return null
  }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

/**
 * How long checks may run before they make the change the person's, where the person opens it while they run: two
 * seconds, not less, as they open it once its card is seen running, which on a slow runner is more than a moment, and
 * checks that ran too long before then are said, rightly.
 */
const STUCK = Duration.seconds(2)

describe('checks Althar sees through, that its host won’t show', () => {
  it.live('make the change the person’s, said once however often the host refuses them', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [{ name: 'test', state: 'running' }] })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      // Its checks run: it is Althar's to see through.
      const [running] = yield* until(cards(project.projectId), (all) => all[0]?.step === 'checks_running', Duration.seconds(20))
      const taskThread = running?.threadId ?? ''
      github.failNext('checks', 'not_found')
      const said = (all: ReadonlyArray<string>) => all.filter((title) => title.startsWith("Althar can't read the checks on PR #1"))
      const [refused] = said(yield* until(notices(taskThread), (all) => said(all).length > 0, Duration.seconds(10)))
      assert.strictEqual(
        refused,
        "Althar can't read the checks on PR #1: its host refused them (The fake checks failed (not_found)). It still listens for what people say on it, and the change is yours now.",
      )
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(10))
      assert.isNull(ready?.step)
      // Refused again on the same commit, nothing more is said.
      const asked = () => github.calls.filter((call) => call === 'checks').length
      const before = asked()
      github.failNext('checks', 'forbidden')
      yield* until(
        Effect.sync(() => [asked()]),
        ([calls = 0]) => calls >= before + 2,
      )
      assert.lengthOf(said(yield* notices(taskThread)), 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('say only that Althar can’t read them once the person has the change', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [{ name: 'test', state: 'passed' }] })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      // The person has opened it: the change is theirs already.
      yield* (yield* Tasks).see({ taskId: ready?.taskId ?? '' })
      github.failNext('checks', 'forbidden')
      const said = (all: ReadonlyArray<string>) => all.filter((title) => title.startsWith("Althar can't read the checks on PR #1"))
      const [refused] = said(yield* until(notices(ready?.threadId ?? ''), (all) => said(all).length > 0, Duration.seconds(10)))
      assert.strictEqual(
        refused,
        "Althar can't read the checks on PR #1: its host refused them (The fake checks failed (forbidden)). It still listens for what people say on it.",
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('that run too long aren’t said to make the change the person’s once it is theirs already', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [{ name: 'test', state: 'running' }] })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [running] = yield* until(cards(project.projectId), (all) => all[0]?.step === 'checks_running', Duration.seconds(20))
      // The person opens it while its checks run: it is theirs from here.
      yield* (yield* Tasks).see({ taskId: running?.taskId ?? '' })
      const asked = () => github.calls.filter((call) => call === 'checks').length
      // Well past how long checks may run, they are looked at again, and nothing is said of it.
      yield* Effect.sleep(STUCK)
      const before = asked()
      yield* until(
        Effect.sync(() => [asked()]),
        ([calls = 0]) => calls >= before + 5,
      )
      assert.isFalse((yield* notices(running?.threadId ?? '')).some((title) => title.includes('have run for')))
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100), checksStuck: STUCK }),
          ),
        ),
      ),
    )
  })
})
