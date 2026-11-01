import { execFileSync } from 'node:child_process'

import { ConnectorFailed } from '@althar/connectors'
import { type FakeService } from '@althar/connectors/testing'
import { Duration, Effect, Layer } from 'effect'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Policies, type RulesChange } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, items, runtime } from './support'

/* What the tests of a task that ends in a pull request share: the runtime they run on, git, and what they read back. */

/** A check's log as a code host refuses it: GitHub's own 403, with its words, as to a sign-in that may not read Actions. */
export const refused = new ConnectorFailed({
  product: 'github',
  reason: 'forbidden',
  status: 403,
  message: 'Resource not accessible by integration',
})
/** A runtime on fake hosts, listening to its changes as often as `listenEvery` says: a tenth of a second unless said. */
export const runtimeWith = (
  services: { readonly github?: FakeService; readonly linear?: FakeService },
  file = ':memory:',
  listenEvery: Duration.Duration = Duration.millis(100),
) => Queries.layer.pipe(Layer.provideMerge(runtime(file, {}, { connectors: fakeConnectors(services), listenEvery })))

export const connect = (product: 'github' | 'linear', webUrl?: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product, token: 't', actorId: instance.personId, ...(webUrl === undefined ? {} : { webUrl }) })
  })

/** Opens the repository as a project, with `rules` where given, and asks its coordinator for a change. */
export const ask = (working: string, body: string, rules?: RulesChange) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (rules !== undefined) yield* (yield* Policies).set(project.projectId, rules, (yield* Instance).personId)
    const threadId = yield* coordinator.thread(project.projectId)
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    return project.projectId
  })

/** Rules where every push is the person's, as before a lead's commits went up on their own (ADR-072). */
export const pushByHand: RulesChange = { pushCommits: false }

export const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** Where the host reads the branch: where the bare repository has it, as a real one does. */
export const tipOf = (bare: string) => () => {
  try {
    return git(bare, 'rev-parse', 'althar/add-a-retry')
  } catch {
    return null
  }
}

export const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

export const arrivals = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'arrival').map((item) => item.content))

/** A pull request's description without what Althar adds of its change's review (pullRequestReview.ts): the seal at its head, and the fold. */
export const withoutReview = (body: string) =>
  body.replace(/^<picture>\n[\s\S]*?\n<\/picture>\n\n/, '').replace(/\n\n<details>\n<summary>Reviewed by [\s\S]*?\n<\/details>/, '')
