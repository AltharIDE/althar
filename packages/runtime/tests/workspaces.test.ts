import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections, NotConnected, OtherAccount } from '../src/Connections'
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
const DEV = { id: 'team-d', key: 'DEV', name: 'Dev' }

/** Two workspaces the same person is in, each with a team and an issue of theirs, and a key both have. */
const workspaces = () => {
  const althar = makeFakeService({ product: 'linear', account: { ...ME, workspace: { key: 'althar', name: 'althar' } } })
  althar.addContainer(ALTHAR)
  althar.addContainer(DEV)
  althar.addIssue({ ref: 'ALT-7', title: 'Bind a project to a workspace' })
  althar.addIssue({ ref: 'ENG-1', title: 'Althar’s ENG-1' })
  const fnt = makeFakeService({ product: 'linear', account: { ...ME, workspace: { key: 'fnt', name: 'FNT' } } })
  fnt.addContainer(FNT)
  fnt.addIssue({ ref: 'FNT-12', title: 'Ship the FNT importer' })
  fnt.addIssue({ ref: 'ENG-1', title: 'FNT’s ENG-1' })
  return { althar, fnt }
}

const withWorkspaces = (services: ReturnType<typeof workspaces>, database = ':memory:', keychain?: Map<string, string>) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        database,
        {},
        {
          connectors: fakeConnectors({ linear: { althar: services.althar, fnt: services.fnt } }),
          ...(keychain === undefined ? {} : { keychain }),
        },
      ),
    ),
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

/** A task in a project, with an issue of its tracker's attached. */
const withIssue = (projectId: ProjectId, issue: string) =>
  Effect.gen(function* () {
    const task = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title: issue,
    })
    yield* (yield* Issues).attach({ projectId, taskId: task.taskId, issue })
    return task.taskId
  })

/** The connection a task's issue is read and moved through, as its board says. */
const issueConnection = (projectId: string, taskId: string) =>
  Effect.map(
    Effect.flatMap(Queries, (queries) => queries.board(projectId)),
    (board) => board.tasks.find((task) => task.taskId === taskId)?.issue?.connectionId,
  )

/** The connections a project's drafts go through. */
const draftConnections = (projectId: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.map(sql<{ connectionId: string }>`SELECT connection_id FROM issue_drafts WHERE project_id = ${projectId}`, (rows) =>
      rows.map((row) => row.connectionId),
    ),
  )

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

      // Signed in again, a connection stays in its own workspace: another picked on Linear's page is refused, not added.
      const refused = yield* Effect.flip(
        connections.connectToken({ product: 'linear', token: 'althar', connectionId: second.id, actorId: (yield* Instance).personId }),
      )
      assert.instanceOf(refused, OtherAccount)
      assert.deepInclude(refused, { login: 'mate.kokai99 in althar', expected: 'mate.kokai99 in FNT' })

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
      // A link to a workspace not connected isn't read through another, where the same key is another issue.
      const elsewhere = yield* Effect.flip(issues.read('https://linear.app/blushh/issue/ENG-1/theirs', ours.projectId))
      assert.instanceOf(elsewhere, NotConnected)

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

  it.live('serve several projects from one connection, each bound to its own team there', () => {
    const services = workspaces()
    return Effect.gen(function* () {
      const althar = yield* connect('althar')
      const app = yield* project()
      const site = yield* project()
      yield* bind(app.projectId, althar.id, DEV)
      yield* bind(site.projectId, althar.id, ALTHAR)
      assert.match(
        yield* callTool(app.access, 'draft_issue', { title: 'App’s', description: '' }),
        /^Drafted the issue “App’s” on Linear, in Dev\./,
      )
      assert.match(
        yield* callTool(site.access, 'draft_issue', { title: 'Site’s', description: '' }),
        /^Drafted the issue “Site’s” on Linear, in Althar\./,
      )
      // Both list the workspace's issues, as the team is where they file, not what they read.
      assert.deepStrictEqual(yield* titles(app.projectId), yield* titles(site.projectId))
    }).pipe(Effect.provide(withWorkspaces(services)))
  })

  it.live('go on through a workspace removed and connected again: its issues, drafts and binding, never another’s', () => {
    const services = workspaces()
    return Effect.gen(function* () {
      const connections = yield* Connections
      const althar = yield* connect('althar')
      const fnt = yield* connect('fnt')
      const ours = yield* project()
      const taskId = yield* withIssue(ours.projectId, 'ALT-7')
      const theirs = yield* withIssue(ours.projectId, 'https://linear.app/fnt/issue/FNT-12/ship')
      yield* callTool(ours.access, 'draft_issue', { title: 'Pending', description: '', tracker: 'Linear (althar)' })
      assert.strictEqual(yield* issueConnection(ours.projectId, taskId), althar.id)

      // Removed, its issues are read through nothing: they say so.
      yield* connections.remove(althar.id, (yield* Instance).personId)
      // The same workspace connected again is a new connection, which they go on through; the other workspace's stay its.
      const back = yield* connect('althar')
      assert.notStrictEqual(back.id, althar.id)
      assert.strictEqual(yield* issueConnection(ours.projectId, taskId), back.id)
      assert.strictEqual(yield* issueConnection(ours.projectId, theirs), fnt.id)
      assert.deepStrictEqual(yield* draftConnections(ours.projectId), [back.id])
    }).pipe(Effect.provide(withWorkspaces(services)))
  })

  it.live('move what a workspace removed before left behind to the same one connected since, at launch', () => {
    const services = workspaces()
    const file = join(mkdtempSync(join(tmpdir(), 'althar-workspaces-')), 'althar.sqlite')
    return Effect.gen(function* () {
      // As an earlier Althar left it: the issue's connection removed, its workspace unknown, the same one connected anew.
      const { projectId, taskId, back } = yield* Effect.gen(function* () {
        const connections = yield* Connections
        const sql = yield* SqlClient.SqlClient
        const althar = yield* connect('althar')
        const { projectId } = yield* project()
        const taskId = yield* withIssue(projectId, 'ALT-7')
        yield* connections.remove(althar.id, (yield* Instance).personId)
        const back = yield* connect('althar')
        yield* sql`UPDATE external_links SET connection_id = ${althar.id} WHERE task_id = ${taskId}`
        yield* sql`UPDATE connections SET workspace_key = NULL, workspace_name = NULL WHERE id = ${althar.id}`
        return { projectId, taskId, back }
      }).pipe(Effect.provide(withWorkspaces(services, file)))

      const after = yield* issueConnection(projectId, taskId).pipe(Effect.provide(withWorkspaces(services, file)))
      assert.strictEqual(after, back.id)
    })
  })

  it.live('learn the workspace of a connection made before Althar kept it, at launch, and route its links by it', () => {
    const services = workspaces()
    const file = join(mkdtempSync(join(tmpdir(), 'althar-workspaces-')), 'althar.sqlite')
    return Effect.gen(function* () {
      const keychain = new Map<string, string>()
      // As an Althar before migration 0041 left it: a Linear connection not knowing its workspace, beside one connected since.
      const { althar, fnt } = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const althar = yield* connect('althar')
        const fnt = yield* connect('fnt')
        yield* sql`UPDATE connections SET workspace_key = NULL, workspace_name = NULL WHERE id = ${fnt.id}`
        // Not knowing its own, it is taken for any workspace's link no other connection is in.
        assert.strictEqual((yield* (yield* Connections).resolve('https://linear.app/blushh/issue/ENG-1/x'))?.connectionId, fnt.id)
        return { althar, fnt }
      }).pipe(Effect.provide(withWorkspaces(services, file, keychain)))

      yield* Effect.gen(function* () {
        const connections = yield* Connections
        const learned = yield* Effect.map(connections.list, (all) => all.map((one) => [one.id, one.workspace?.name ?? null])).pipe(
          Effect.repeat({ until: (pairs) => pairs.every(([, key]) => key !== null), schedule: Schedule.spaced('20 millis') }),
          Effect.timeout('5 seconds'),
        )
        assert.sameDeepMembers(learned, [
          [althar.id, 'althar'],
          [fnt.id, 'FNT'],
        ])
        // Each link goes to its own workspace's, where the same key is another issue, and another workspace's to none.
        const issues = yield* Issues
        assert.isNull(yield* connections.resolve('https://linear.app/blushh/issue/ENG-1/x'))
        assert.deepInclude(yield* issues.read('https://linear.app/fnt/issue/ENG-1/x'), { title: 'FNT’s ENG-1', connectionId: fnt.id })
        assert.deepInclude(yield* issues.read('https://linear.app/althar/issue/ENG-1/x'), {
          title: 'Althar’s ENG-1',
          connectionId: althar.id,
        })
      }).pipe(Effect.provide(withWorkspaces(services, file, keychain)))
    })
  })

  it.live('keep a project bound to a workspace disconnected from going to another in its place', () => {
    const services = workspaces()
    return Effect.gen(function* () {
      const connections = yield* Connections
      yield* connect('althar')
      const fnt = yield* connect('fnt')
      const theirs = yield* project()
      yield* bind(theirs.projectId, fnt.id, FNT)
      yield* connections.remove(fnt.id, (yield* Instance).personId)

      // Althar's workspace, the one left, is neither listed nor drafted to in FNT's place.
      assert.deepStrictEqual(yield* titles(theirs.projectId), [])
      assert.notMatch(yield* callTool(theirs.access, 'find_issues', {}), /ALT-7/)
      const refused = yield* callTool(theirs.access, 'draft_issue', { title: 'Theirs', description: '' })
      assert.match(refused, /go to Linear \(FNT\), which is no longer connected/)
      assert.notMatch(refused, /^Drafted/)
      // Named, another still takes it.
      assert.match(
        yield* callTool(theirs.access, 'draft_issue', { title: 'Named', description: '', tracker: 'Linear', container: 'ALT' }),
        /^Drafted the issue “Named” on Linear, in Althar\./,
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
        gone: null,
      })
      // Disconnected, it is still bound, to one gone; the same workspace connected again, to that.
      yield* connections.remove(fnt.id, (yield* Instance).personId)
      assert.deepInclude(yield* projectTracker(projectId), {
        connectionId: fnt.id,
        gone: { webUrl: 'https://linear.app', workspace: 'FNT' },
      })
      const back = yield* connect('fnt')
      assert.strictEqual((yield* projectTracker(projectId))?.connectionId, back.id)

      // Unbound again, it goes back to learning.
      yield* projects.setTracker(projectId, null)
      assert.isNull(yield* projectTracker(projectId))
    }).pipe(Effect.provide(withWorkspaces(services)))
  })
})
