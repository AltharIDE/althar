import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConnectorFailed } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { MessageSender } from '@althar/contracts'
import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { coordinatorFolder } from '../src/coordinatorFolder'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * The coordinator's part in a release (ADR-081, "A release"): tagging,
 * approving a run and publishing, each on the person's word and read from
 * the host before it acts; reading a release and its runs; running failed
 * jobs again; and a release errand that goes on across a restart without
 * doing anything twice. Every host here is a fake: no real tag is pushed and
 * nothing is published.
 */

const PATH = ['meridian', 'api']
const OTHER = '5ca1ab1e5ca1ab1e5ca1ab1e5ca1ab1e5ca1ab1e'

const withHost = (host: FakeService, database = ':memory:') => runtime(database, {}, { connectors: fakeConnectors({ github: host }) })

/** The coordinator of a project of the repository, its host connected, with a live turn of its own to give word or news in. */
const project = (working: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const opened = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* (yield* Coordinator).thread(opened.projectId)
    return { coordinator: yield* session(opened.projectId, threadId), sql }
  })

/** A session of the coordinator's, as one starts after a restart. */
const session = (projectId: string, threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    return { role: 'coordinator', projectId, threadId, taskId: null, sessionId } satisfies ToolAccess
  })

/** A turn begins: by the person's message in the window, or by news, which gives no word. Its message's id. */
const turn = (access: ToolAccess, body: string, sender: MessageSender = { kind: 'window' }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const origin = sender.kind === 'window' || sender.kind === 'paired_device' ? 'person' : 'news'
    yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${access.threadId} AND state = 'delivered'`
    const accepted = yield* (yield* Sessions).send({
      envelope: yield* Runtime.envelope('thread.send', {}),
      threadId: access.threadId,
      body,
      sender,
      origin: origin === 'news' ? 'news' : 'system',
    })
    const turnId = yield* newId(Ids.turnDelivery)
    yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: access.projectId, threadId: access.threadId, providerSessionId: access.sessionId, controllerGeneration: 1, state: 'delivered', origin, requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
    yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: access.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
    return accepted.inputId
  })

/** What Althar said in the coordinator's chat, in order. */
const lines = (access: ToolAccess) =>
  Effect.map(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) =>
        sql<{ content: string }>`SELECT content FROM thread_items WHERE thread_id = ${access.threadId} AND kind = 'notice' ORDER BY rowid`,
    ),
    (rows) => rows.map((row) => (JSON.parse(row.content) as { title: string }).title),
  )

const github = () => {
  const host = makeFakeService()
  const repository = host.addRepository(PATH)
  return { host, repository, working: hosted(PATH).working }
}

describe('the coordinator tagging', () => {
  it.live('tags the default branch’s head on the person’s word, once, says so in its chat, and refuses news', () => {
    const { host, repository, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      const head = yield* host.commitOf(repository, 'main')

      const news = yield* turn(coordinator, 'Release 0.7.0', { kind: 'internal' })
      assert.match(yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', message: news }), /window or a paired device/)
      assert.lengthOf(host.tagsPushed, 0)

      const word = yield* turn(coordinator, 'Tag 0.7.0')
      const said = yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', message: word })
      assert.include(said, `Pushed the tag v0.7.0 on ${head.slice(0, 8)} on meridian/api`)
      assert.deepStrictEqual(host.tagsPushed, [{ name: 'v0.7.0', commit: head, moved: false }])
      // Its note is the one short line, not the person's words again.
      assert.isTrue(
        (yield* lines(coordinator)).some((line) => line.startsWith('Pushed the tag v0.7.0 on ') && !line.includes('Tag 0.7.0"')),
      )
      // Asked again, it is done already: nothing more is pushed.
      yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', message: word })
      assert.lengthOf(host.tagsPushed, 1)
      assert.include(yield* callTool(coordinator, 'push_tag', { tag: '-delete', message: word }), "isn't a name git takes")
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('refuses a tag that exists on another commit unless the person asked to move it, then moves it', () => {
    const { host, repository, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      const head = yield* host.commitOf(repository, 'main')

      const word = yield* turn(coordinator, 'Tag main 0.7.0')
      const refused = yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', message: word })
      assert.include(refused, 'v0.7.0 is on 5ca1ab1e already')
      assert.include(refused, 'Moving a tag must be asked for')
      assert.strictEqual((yield* host.tag(repository, 'v0.7.0'))?.commit, OTHER)

      const moving = yield* turn(coordinator, 'Move v0.7.0 to main')
      assert.include(yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', move: true, message: moving }), 'Moved the tag v0.7.0')
      assert.strictEqual((yield* host.tag(repository, 'v0.7.0'))?.commit, head)
      // On a commit the person names, and deleted on their word.
      const named = yield* turn(coordinator, `Tag ${OTHER.slice(0, 7)} as v0.6.9, then delete it`)
      assert.include(yield* callTool(coordinator, 'push_tag', { tag: 'v0.6.9', commit: OTHER, message: named }), 'on 5ca1ab1e')
      assert.include(yield* callTool(coordinator, 'push_tag', { tag: 'v0.6.9', delete: true, message: named }), 'Deleted the tag v0.6.9')
      assert.deepStrictEqual(host.tagsDeleted, ['v0.6.9'])
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('pushes a tag again that someone deleted since, on the person’s word again, and only once more', () => {
    const { host, repository, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      const word = yield* turn(coordinator, 'Tag 0.7.0')
      yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', message: word })
      // Someone deletes it on GitHub; done before isn't done now.
      yield* host.deleteTag(repository, 'v0.7.0')
      const again = yield* turn(coordinator, 'Tag 0.7.0 again, it’s gone')
      assert.include(yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', message: again }), 'Pushed the tag v0.7.0')
      assert.isNotNull(yield* host.tag(repository, 'v0.7.0'))
      assert.include(yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', message: again }), 'is on')
      assert.lengthOf(host.tagsPushed, 2)
    }).pipe(Effect.provide(withHost(host)))
  })
})

describe('the coordinator approving and publishing', () => {
  it.live('says so with the host’s button where the account can’t approve the environment, and approves where it can', () => {
    const { host, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      const run = host.startRun(PATH, { ref: 'v0.7.0', gates: [{ name: 'release', approvable: false }] })
      const read = yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' })
      assert.include(read, "which the connected account can't approve")
      assert.include(read, run.url ?? 'no url')
      assert.include(read, 'Prevent self-review')

      const word = yield* turn(coordinator, 'Approve the release run')
      const refused = yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', gate: 'release', message: word })
      assert.include(refused, "can't approve")
      assert.include(refused, run.url ?? 'no url')
      assert.include(refused, 'Nothing was approved')
      assert.lengthOf(host.approvals, 0)

      host.startRun(PATH, { ref: 'v0.7.0', name: 'homebrew-tap', gates: [{ name: 'release' }] })
      const again = yield* turn(coordinator, 'Approve the tap')
      const approved = yield* callTool(coordinator, 'approve_release_run', {
        tag: 'v0.7.0',
        gate: 'release',
        workflow: 'homebrew-tap',
        message: again,
      })
      assert.include(approved, 'Approved release for homebrew-tap on v0.7.0')
      assert.lengthOf(host.approvals, 1)
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('approves again after a rerun waits on the same gate anew, and never says approved where it wasn’t', () => {
    const { host, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      const args = { tag: 'v0.7.0', gate: 'release', workflow: 'release' }
      host.startRun(PATH, { ref: 'v0.7.0', name: 'release', gates: [{ name: 'release' }] })
      const word = yield* turn(coordinator, 'Approve the release')
      assert.include(yield* callTool(coordinator, 'approve_release_run', { ...args, message: word }), 'Approved release')
      // Given, the run goes on: asked again, it isn't said to be approved again.
      assert.include(yield* callTool(coordinator, 'approve_release_run', { ...args, message: word }), 'goes on')
      assert.lengthOf(host.approvals, 1)
      // A job failed, it ran again, and its run waits on release anew.
      host.startRun(PATH, { ref: 'v0.7.0', name: 'release', gates: [{ name: 'release' }] })
      const again = yield* turn(coordinator, 'Approve it again')
      assert.include(yield* callTool(coordinator, 'approve_release_run', { ...args, message: again }), 'Approved release')
      assert.lengthOf(host.approvals, 2)
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('publishes a draft only once its run has drafted it, and only once', () => {
    const { host, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      const word = yield* turn(coordinator, 'Publish 0.7.0')
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: word }), 'no draft release of v0.7.0 yet')
      host.draftRelease(PATH, 'v0.7.0', ['Althar-0.7.0-arm64.dmg', 'Althar-0.7.0-x64.dmg'])
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }), 'A draft release of v0.7.0')
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: word }), 'Published v0.7.0')
      assert.deepStrictEqual(host.published, ['v0.7.0'])
      yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: word })
      assert.deepStrictEqual(host.published, ['v0.7.0'])
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }), 'v0.7.0 is published')
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('runs a tag’s failed run again, in any turn', () => {
    const { host, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      assert.include(yield* callTool(coordinator, 'rerun_failed_jobs', { tag: 'v0.7.0' }), 'No run on v0.7.0')
      const run = host.startRun(PATH, { ref: 'v0.7.0', state: 'failed' })
      yield* turn(coordinator, 'news', { kind: 'internal' })
      assert.include(yield* callTool(coordinator, 'rerun_failed_jobs', { tag: 'v0.7.0' }), "Running release's failed jobs on v0.7.0 again")
      assert.deepStrictEqual(host.rerunRuns, [run.id])
    }).pipe(Effect.provide(withHost(host)))
  })
})

describe('the coordinator where there is nothing to do yet', () => {
  it.live('reads no release before its draft, approves nothing before a run, and runs nothing again where nothing failed', () => {
    const { host, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }), 'The tag v0.7.0 is on 5ca1ab1e on meridian/api.')
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v9' }), 'meridian/api has no tag v9.')
      const word = yield* turn(coordinator, 'Approve the release run')
      assert.include(
        yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', gate: 'release', message: word }),
        'No run on v0.7.0 yet: nothing waits for release.',
      )
      assert.include(
        yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', gate: 'release', workflow: 'release', message: word }),
        'No run of release on v0.7.0 yet',
      )
      host.startRun(PATH, { ref: 'v0.7.0', name: 'release', state: 'running' })
      assert.include(
        yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', gate: 'release', message: word }),
        'The run on v0.7.0 goes on, and waits for release not yet, or no longer.',
      )
      assert.lengthOf(host.approvals, 0)
      assert.include(
        yield* callTool(coordinator, 'rerun_failed_jobs', { tag: 'v0.7.0' }),
        'None of the runs on v0.7.0 failed (release: running), so nothing runs again.',
      )
      host.draftRelease(PATH, 'v0.7.0', [])
      assert.include(
        yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }),
        'A draft release of v0.7.0, "v0.7.0", not published: no files.',
      )
      const publish = yield* turn(coordinator, 'Publish it')
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: publish }), 'Published v0.7.0')
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: publish }), 'v0.7.0 is published already')
      assert.match(
        yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0', repository: 'nowhere' }),
        /^The project’s repositories are .*\. Name one of those\.$/,
      )
    }).pipe(Effect.provide(withHost(host)))
  })
})

describe('the coordinator releasing on Bitbucket', () => {
  it.live('links the manual step only the person runs, and puts the repository’s files in Downloads', () => {
    // Through the one fake host the harness connects, as Bitbucket Cloud's adapter releases.
    const host = makeFakeService({ product: 'bitbucket_cloud' })
    host.addRepository(PATH)
    const { working } = hosted(PATH)
    writeFileSync(join(working, 'Althar-0.7.0.zip'), 'zip')
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      const run = host.startRun(PATH, { ref: 'v0.7.0', gates: [{ name: 'Deploy' }] })
      const word = yield* turn(coordinator, 'Release 0.7.0 and publish it')
      const step = yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', message: word })
      assert.include(step, 'Bitbucket has no API to run one')
      assert.include(step, run.url ?? 'no url')
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: word }), 'name them (files)')
      const outside = mkdtempSync(join(tmpdir(), 'althar-outside-'))
      writeFileSync(join(outside, 'secret.txt'), 'no')
      assert.include(
        yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', files: [join(outside, 'secret.txt')], message: word }),
        "isn't a file in one of the project's repositories",
      )
      assert.include(
        yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', files: ['Althar-0.7.0.zip'], message: word }),
        'Put Althar-0.7.0.zip in meridian/api',
      )
      assert.deepStrictEqual(host.published, ['v0.7.0'])
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('puts the rest in Downloads after a publish refused half way, and nothing twice', () => {
    const host = makeFakeService({ product: 'bitbucket_cloud' })
    const repository = host.addRepository(PATH)
    const { working } = hosted(PATH)
    writeFileSync(join(working, 'Althar-0.7.0.zip'), 'zip')
    writeFileSync(join(working, 'Althar-0.7.0.dmg'), 'dmg')
    // The first file goes up, and the host stops answering before the second.
    let half = true
    const halting: FakeService = {
      ...host,
      publishRelease: (repo, tag, release) => {
        if (!half) return host.publishRelease(repo, tag, release)
        half = false
        return Effect.flatMap(host.publishRelease(repo, tag, { files: (release.files ?? []).slice(0, 1) }), () =>
          Effect.fail(
            new ConnectorFailed({ product: 'bitbucket_cloud', reason: 'unreachable', message: 'The service did not answer in time' }),
          ),
        )
      },
    }
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      const word = yield* turn(coordinator, 'Publish 0.7.0')
      const files = ['Althar-0.7.0.zip', 'Althar-0.7.0.dmg']
      assert.notInclude(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', files, message: word }), 'Put ')
      // Read back: one is there, the other isn't, so the rest goes up.
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', files, message: word }), 'Put Althar-0.7.0.zip')
      const names = ((yield* host.release(repository, 'v0.7.0'))?.files ?? []).map((file) => file.name)
      assert.sameMembers(names, files)
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', files, message: word }), 'holds')
    }).pipe(Effect.provide(withHost(halting)))
  })
})

describe('the coordinator releasing where a host has no drafts, or no releases', () => {
  it.live('on GitLab, makes the release, which is publishing it, once there is a tag', () => {
    const host = makeFakeService({ product: 'gitlab' })
    host.addRepository(PATH)
    const { working } = hosted(PATH)
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      const word = yield* turn(coordinator, 'Publish 0.7.0, approve its run, and delete v0.6.0')
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }), 'has no tag v0.7.0')
      // Deleting takes no commit nor a move; one that isn't there is nothing to delete.
      assert.include(
        yield* callTool(coordinator, 'push_tag', { tag: 'v0.6.0', delete: true, move: true, message: word }),
        'Deleting a tag takes no commit',
      )
      assert.include(yield* callTool(coordinator, 'push_tag', { tag: 'v0.6.0', delete: true, message: word }), 'nothing to delete')
      // Nothing to approve before there is a run, nor once its runs are done.
      assert.include(
        yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', workflow: 'deploy', message: word }),
        'No run of deploy on v0.7.0 yet',
      )
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: word }), 'push_tag makes it first')
      assert.include(
        yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', files: ['a.zip'], message: word }),
        'publish without files',
      )
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      const before = yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' })
      assert.include(before, 'has no drafts: publish_release makes it')
      assert.include(before, 'No CI run on v0.7.0 yet')
      assert.include(
        yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', name: 'Meridian 0.7', notes: 'Faster', message: word }),
        'Published v0.7.0',
      )
      // Asked again, it is released already: nothing more is made.
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: word }), 'v0.7.0 is released already')
      assert.deepStrictEqual(host.published, ['v0.7.0'])
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }), 'v0.7.0 is published')
      // A deployment only another reviewer approves; and nothing failed to run again.
      host.startRun(PATH, { ref: 'v0.7.0', name: 'deploy', state: 'passed', gates: [{ name: 'production', approvable: false }] })
      const read = yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' })
      assert.include(read, "which the connected account can't approve")
      assert.include(yield* callTool(coordinator, 'rerun_failed_jobs', { tag: 'v0.7.0' }), 'None of the runs on v0.7.0 failed')
      assert.include(
        yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', message: word }),
        "deploy on v0.7.0 waits for production, which the connected account can't approve",
      )
      assert.include(yield* callTool(coordinator, 'rerun_failed_jobs', { tag: 'v0.7.0', workflow: 'lint' }), 'No run on v0.7.0 of lint')
      assert.include(yield* callTool(coordinator, 'read_release_steps', {}), 'GitLab has no drafts')
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('on Bitbucket Cloud, reads the tag and its Downloads, and runs a failed pipeline again whole', () => {
    const host = makeFakeService({ product: 'bitbucket_cloud' })
    host.addRepository(PATH)
    const { working } = hosted(PATH)
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      assert.include(
        yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }),
        'Bitbucket Cloud has no releases: the tag v0.7.0 is there',
      )
      const run = host.startRun(PATH, { ref: 'v0.7.0', name: 'release', state: 'failed' })
      assert.include(yield* callTool(coordinator, 'rerun_failed_jobs', { tag: 'v0.7.0' }), 'Bitbucket runs the pipeline again whole')
      assert.deepStrictEqual(host.rerunRuns, [run.id])
      assert.include(yield* callTool(coordinator, 'read_release_steps', {}), 'the tag, then its files in Downloads')
    }).pipe(Effect.provide(withHost(host)))
  })

  it.live('on Bitbucket Data Center, says the tag is the release and refuses to publish', () => {
    const host = makeFakeService({ product: 'bitbucket_dc' })
    host.addRepository(PATH)
    const { working } = hosted(PATH)
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      const word = yield* turn(coordinator, 'Publish 0.7.0')
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }), 'No tag v0.7.0, so no release.')
      host.tagByHand(PATH, 'v0.7.0', OTHER)
      assert.include(yield* callTool(coordinator, 'read_release', { tag: 'v0.7.0' }), 'Bitbucket Data Center has no releases')
      assert.include(yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', message: word }), 'There is nothing to publish')
      assert.include(
        yield* callTool(coordinator, 'approve_release_run', { tag: 'v0.7.0', message: word }),
        'whoever runs them approves them there',
      )
      assert.include(yield* callTool(coordinator, 'read_release_steps', { repository: 'nowhere' }), 'The project’s repositories are')
      assert.include(yield* callTool(coordinator, 'read_release_steps', {}), 'Bitbucket Data Center has no releases')
    }).pipe(Effect.provide(withHost(host)))
  })
})

describe('another repository’s release steps', () => {
  it.live('reads its release workflow from the coordinator’s copy, and asks the person where it says nothing', () => {
    const { host, working } = github()
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      assert.include(yield* callTool(coordinator, 'read_release_steps', {}), 'says nothing of how it is released')
      mkdirSync(join(working, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(working, '.github', 'workflows', 'ship.yml'),
        "on:\n  push:\n    tags: ['v*']\njobs:\n  ship:\n    environment: production\n",
      )
      writeFileSync(join(working, '.github', 'workflows', 'lint.yml'), 'on: pull_request\njobs:\n  lint: {}\n')
      execFileSync('git', ['add', '-A'], { cwd: working })
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-qm', 'Ship on a tag'], { cwd: working })
      // Each turn's copy is fresh from the default branch.
      yield* coordinatorFolder(coordinator.projectId)
      const steps = yield* callTool(coordinator, 'read_release_steps', {})
      assert.include(steps, '--- .github/workflows/ship.yml')
      assert.include(steps, 'environment: production')
      assert.notInclude(steps, 'lint.yml')
      assert.include(steps, 'GitHub drafts a release')
      assert.include(steps, 'keep_note')
    }).pipe(Effect.provide(withHost(host)))
  })
})

describe('a release errand', () => {
  it.live('goes on across a restart in the middle, reading back what it did and doing nothing twice', () =>
    Effect.gen(function* () {
      const database = join(mkdtempSync(join(tmpdir(), 'althar-release-restart-')), 'profile.sqlite')
      const { host, repository, working } = github()
      // The approval reaches GitHub, and its answer is lost on the way back, once.
      let lose = true
      const lossy: FakeService = {
        ...host,
        approveRun: (...args: Parameters<FakeService['approveRun']>) =>
          Effect.flatMap(host.approveRun(...args), (run) => {
            if (!lose) return Effect.succeed(run)
            lose = false
            return Effect.fail(
              new ConnectorFailed({ product: 'github', reason: 'unreachable', message: 'The service did not answer in time' }),
            )
          }),
      }
      const head = yield* host.commitOf(repository, 'main')
      const where = 'meridian/api'
      const steps = [
        {
          key: 'tag',
          tool: 'push_tag',
          target: `${where} tag v0.7.0`,
          request: { tag: 'v0.7.0', commit: head },
          waits: [{ kind: 'post-merge', target: head }],
        },
        {
          key: 'approve',
          tool: 'approve_release_run',
          target: `${where} tag v0.7.0 approval`,
          request: { tag: 'v0.7.0', gate: 'release', workflow: 'release' },
          waits: [{ kind: 'run', target: 'v0.7.0' }],
        },
        {
          key: 'publish',
          tool: 'publish_release',
          target: `${where} release v0.7.0`,
          request: { tag: 'v0.7.0' },
          waits: [{ kind: 'draft', target: 'v0.7.0' }],
        },
      ]
      const before = yield* Effect.gen(function* () {
        const { coordinator } = yield* project(working)
        const word = yield* turn(coordinator, 'Release 0.7.0, and publish it once the draft is there')
        const kept = yield* callTool(coordinator, 'keep_errand', { message: word, steps })
        const errand = /^errand_[0-9a-f]+$/.test(kept) ? kept : ''
        assert.isNotEmpty(errand, kept)
        // News starts the next turns: only the errand's steps go.
        yield* turn(coordinator, 'post-merge passed on main', { kind: 'internal' })
        assert.include(
          yield* callTool(coordinator, 'push_tag', { tag: 'v0.7.0', commit: head, errand, step: 'tag' }),
          'Pushed the tag v0.7.0',
        )
        host.startRun(PATH, { ref: 'v0.7.0', name: 'release', gates: [{ name: 'release' }] })
        yield* turn(coordinator, 'The release run waits for approval', { kind: 'internal' })
        const lost = yield* callTool(coordinator, 'approve_release_run', {
          tag: 'v0.7.0',
          gate: 'release',
          workflow: 'release',
          errand,
          step: 'approve',
        })
        assert.include(lost, 'uncertain')
        return { errand, projectId: coordinator.projectId, threadId: coordinator.threadId }
      }).pipe(Effect.provide(withHost(lossy, database)))
      assert.lengthOf(host.approvals, 1, 'the approval happened; only its answer was lost')

      // Althar starts again, over the same profile; the coordinator's new session hears news.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const coordinator = yield* session(before.projectId, before.threadId)
        yield* turn(coordinator, 'The release run goes on', { kind: 'internal' })
        const args = { tag: 'v0.7.0', gate: 'release', workflow: 'release', errand: before.errand, step: 'approve' }
        // Read back: nothing waits for release any more while the run goes on, so it was given; nothing is approved again.
        assert.include(yield* callTool(coordinator, 'approve_release_run', args), 'any more: it was given')
        assert.include(
          yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', errand: before.errand, step: 'publish' }),
          'no draft release of v0.7.0 yet',
        )
        const [run] = yield* host.runs(repository, 'v0.7.0')
        host.finishRun(run!.id, 'passed')
        host.draftRelease(PATH, 'v0.7.0', ['Althar-0.7.0-arm64.dmg'])
        yield* turn(coordinator, 'The draft is there', { kind: 'internal' })
        assert.include(
          yield* callTool(coordinator, 'publish_release', { tag: 'v0.7.0', errand: before.errand, step: 'publish' }),
          'Published v0.7.0',
        )
        assert.lengthOf(host.tagsPushed, 1)
        assert.lengthOf(host.approvals, 1)
        assert.deepStrictEqual(host.published, ['v0.7.0'])
        assert.strictEqual((yield* sql<{ state: string }>`SELECT state FROM errands WHERE id = ${before.errand}`)[0]?.state, 'done')
      }).pipe(Effect.provide(withHost(host, database)))
    }),
  )
})
