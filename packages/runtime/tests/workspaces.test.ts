import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Issues } from '../src/Issues'
import { projectTracker } from '../src/projectTracker'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, repository, runtime } from './support'

/*
 * Several workspaces of Linear's, and a project bound to one (ADR-059): a
 * sign-in reaches one workspace, so each is a connection beside the others,
 * and a project bound to one drafts its issues there, lists its issues from
 * it alone, and looks for a bare key there first. One bound to none goes on
 * as before, across them all.
 */

const ME = { id: 'u-1', login: 'mate.kokai99', name: 'Mate' }
const ALTHAR = { id: 'team-a', key: 'ALT', name: 'Althar' }
const FNT = { id: 'team-f', key: 'FNT', name: 'FNT' }

/** Two workspaces the same person is in, each with a team and an issue of theirs, and a key both have. */
const workspaces = () => {
  const althar = makeFakeService({ product: 'linear', account: { ...ME, workspace: { key: 'althar', name: 'althar' } } })
  althar.addContainer(ALTHAR)
  althar.addIssue({ ref: 'ALT-7', title: 'Bind a project to a workspace' })
  althar.addIssue({ ref: 'ENG-1', title: 'Althar’s ENG-1' })
  const fnt = makeFakeService({ product: 'linear', account: { ...ME, workspace: { key: 'fnt', name: 'FNT' } } })
  fnt.addContainer(FNT)
  fnt.addIssue({ ref: 'FNT-12', title: 'Ship the FNT importer' })
  fnt.addIssue({ ref: 'ENG-1', title: 'FNT’s ENG-1' })
  return { althar, fnt }
}

const withWorkspaces = (services: ReturnType<typeof workspaces>) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: { althar: services.althar, fnt: services.fnt } }) })),
  )

const connect = (token: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product: 'linear', token, actorId: instance.personId })
  })

const project = () =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const threadId = yield* coordinator.thread(opened.projectId)
    const access: ToolAccess = { role: 'coordinator', projectId: opened.projectId, threadId, sessionId: 's', taskId: null }
    return { projectId: opened.projectId as ProjectId, access }
  })

const bind = (projectId: string, connectionId: string, container: { readonly id: string; readonly name: string } | null = null) =>
  Effect.flatMap(Projects, (projects) => projects.setTracker(projectId, { connectionId, container }))

const titles = (projectId: string) =>
  Effect.map(
    Effect.flatMap(Issues, (issues) => issues.mine(projectId)),
    (found) => found.map((issue) => issue.key).toSorted(),
  )

describe('several Linear workspaces', () => {
  it.live('are connected side by side, each saying its workspace; the same one connected again is renewed', () => {
    const services = workspaces()
    return Effect.gen(function* () {
      const connections = yield* Connections
      const first = yield* connect('althar')
      const second = yield* connect('fnt')
      assert.notStrictEqual(first.id, second.id)
      const again = yield* connect('althar')
      assert.strictEqual(again.id, first.id)

      const listed = (yield* connections.list).filter((one) => one.product === 'linear')
      assert.deepStrictEqual(
        listed
          .map((one) => ({ login: one.account.login, workspace: one.workspace }))
          .toSorted((a, b) => a.login.localeCompare(b.login) || (a.workspace?.key ?? '').localeCompare(b.workspace?.key ?? '')),
        [
          { login: 'mate.kokai99', workspace: { key: 'althar', name: 'althar' } },
          { login: 'mate.kokai99', workspace: { key: 'fnt', name: 'FNT' } },
        ],
      )
      const sql = yield* SqlClient.SqlClient
      const [kept] = yield* sql<{
        count: number
      }>`SELECT count(*) AS count FROM connections WHERE product = 'linear' AND state <> 'removed'`
      assert.strictEqual(kept?.count, 2)

      // Each disconnects on its own.
      yield* connections.remove(second.id, (yield* Instance).personId)
      assert.deepStrictEqual(
        (yield* connections.list).filter((one) => one.product === 'linear').map((one) => one.workspace?.key),
        ['althar'],
      )
    }).pipe(Effect.provide(withWorkspaces(services)))
  })

  it.live('send each project to its own: its issues listed, bare keys read, and drafts filed there', () => {
    const services = workspaces()
    return Effect.gen(function* () {
      const althar = yield* connect('althar')
      const fnt = yield* connect('fnt')
      const ours = yield* project()
      const theirs = yield* project()
      const loose = yield* project()
      yield* bind(ours.projectId, althar.id, ALTHAR)
      yield* bind(theirs.projectId, fnt.id)
      const issues = yield* Issues

      // Its issues come from its own workspace; one bound to none lists both, as before.
      assert.deepStrictEqual(yield* titles(ours.projectId), ['ALT-7', 'ENG-1'])
      assert.deepStrictEqual(yield* titles(theirs.projectId), ['ENG-1', 'FNT-12'])
      assert.deepStrictEqual(yield* titles(loose.projectId), ['ALT-7', 'ENG-1', 'ENG-1', 'FNT-12'])
      assert.match(yield* callTool(theirs.access, 'find_issues', {}), /FNT-12/)
      assert.notMatch(yield* callTool(theirs.access, 'find_issues', {}), /ALT-7/)

      // A key both workspaces have is its own workspace's first.
      assert.strictEqual((yield* issues.read('ENG-1', ours.projectId)).title, 'Althar’s ENG-1')
      assert.strictEqual((yield* issues.read('ENG-1', theirs.projectId)).title, 'FNT’s ENG-1')
      // A key only another workspace has, or a link to one there, still reads.
      assert.strictEqual((yield* issues.read('FNT-12', ours.projectId)).connectionId, fnt.id)
      const linked = yield* issues.read('https://linear.app/fnt/issue/ENG-1/fnts', ours.projectId)
      assert.deepInclude(linked, { title: 'FNT’s ENG-1', connectionId: fnt.id })

      // A draft goes where the project is bound, in the team it was bound to, though two workspaces are connected.
      assert.match(
        yield* callTool(ours.access, 'draft_issue', { title: 'Bound drafts', description: '' }),
        /^Drafted the issue “Bound drafts” on Linear \(althar\), in Althar\./,
      )
      assert.match(
        yield* callTool(theirs.access, 'draft_issue', { title: 'Their drafts', description: '' }),
        /^Drafted the issue “Their drafts” on Linear \(FNT\), in FNT\./,
      )
      // Unbound, nothing learned, two to choose from: it asks, as before.
      assert.match(
        yield* callTool(loose.access, 'draft_issue', { title: 'Loose', description: '' }),
        /Linear \(FNT\), Linear \(althar\)|Linear \(althar\), Linear \(FNT\)/,
      )
    }).pipe(Effect.provide(withWorkspaces(services)))
  })

  it.live('bind a project only to a connection there, and through it again once its workspace is connected anew', () => {
    const services = workspaces()
    return Effect.gen(function* () {
      const connections = yield* Connections
      const projects = yield* Projects
      const fnt = yield* connect('fnt')
      const { projectId } = yield* project()
      const refused = yield* Effect.flip(projects.setTracker(projectId, { connectionId: 'nowhere', container: null }))
      assert.instanceOf(refused, NotFound)

      yield* bind(projectId, fnt.id, FNT)
      assert.deepStrictEqual(yield* projectTracker(projectId), {
        connectionId: fnt.id,
        product: 'linear',
        container: { id: FNT.id, name: FNT.name },
      })
      // Disconnected, it is bound to nothing; the same workspace connected again, to that.
      yield* connections.remove(fnt.id, (yield* Instance).personId)
      assert.isNull(yield* projectTracker(projectId))
      const back = yield* connect('fnt')
      assert.strictEqual((yield* projectTracker(projectId))?.connectionId, back.id)

      // Unbound again, it goes back to learning.
      yield* projects.setTracker(projectId, null)
      assert.isNull(yield* projectTracker(projectId))
    }).pipe(Effect.provide(withWorkspaces(services)))
  })
})
