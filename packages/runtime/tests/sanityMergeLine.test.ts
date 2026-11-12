import type { BranchUpdate, ChangeRequest, CheckState, CodeHost, Repository } from '@althar/connectors'
import type { ChangeSummary } from '@althar/contracts'
import { type FakeCheck, type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { updateBranch } from '../src/coordinatorPullRequests'
import { Instance } from '../src/Instance'
import { MergeLine } from '../src/MergeLine'
import { Projects } from '../src/Projects'
import { sectionWords } from '../src/pullRequestStanding'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { ask, cards as taskCards, connect, git, runtimeWith, tipOf } from './changesSupport'
import { callTool, fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * Sanity pass over the merge line and queue: each test here shows a defect found on current main, written to assert
 * the right behaviour and marked expected-to-fail. Each flips to passing once its defect is fixed.
 */

/** A fake host whose checks a test sets by commit, each commit's list as the test says: one passing check unless said. */
const host = (product?: 'github' | 'gitlab') => {
  const checks = new Map<string, ReadonlyArray<FakeCheck>>()
  const service = makeFakeService({
    ...(product === undefined ? {} : { product }),
    checksFor: (_number, sha) => checks.get(sha) ?? [{ name: 'test', state: 'passed' }],
    checksOn: () => [{ name: 'post-merge', state: 'passed' }],
  })
  service.addRepository(['meridian', 'api'])
  const pull = (title: string) => service.addPullRequest({ path: ['meridian', 'api'], title, author: 'you' })
  const set = (sha: string, ...states: ReadonlyArray<CheckState>) =>
    void checks.set(
      sha,
      states.map((state, index) => ({ name: index === 0 ? 'test' : `test-${index}`, state })),
    )
  return { service, checks, pull, set }
}

/** The project, its coordinator's thread, and a session of its in the store, without an agent. */
const opened = (path: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: project.projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId, taskId: null }
    return access
  })

/** A turn of the coordinator's, as the host records one: the person's message from the window, or news. Gives its message's id. */
const turn = (access: ToolAccess, origin: 'person' | 'news', body = 'Merge them once they’re green') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${access.threadId} AND state = 'delivered'`
    const accepted = yield* (yield* Sessions).send({
      envelope: yield* Runtime.envelope('thread.send', {}),
      threadId: access.threadId,
      body,
      sender: origin === 'person' ? { kind: 'window' } : { kind: 'internal' },
      origin: origin === 'person' ? 'system' : 'news',
    })
    const turnId = yield* newId(Ids.turnDelivery)
    yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: access.projectId, threadId: access.threadId, providerSessionId: access.sessionId, controllerGeneration: 1, state: 'delivered', origin, requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
    yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: access.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
    return accepted.inputId
  })

/** Each merge errand, by its pull request's number. */
const errandsOf = (access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; state: string; number: number }>`
      SELECT e.id, e.state, json_extract(s.request, '$.number') AS number FROM errands e JOIN errand_steps s ON s.errand_id = e.id
      WHERE e.project_id = ${access.projectId} AND s.tool = 'merge_pull_request' ORDER BY e.created_at, e.rowid`
    return new Map(rows.map((row) => [row.number, row]))
  })

/** The merge line's cards in the coordinator's thread: what each says of each pull request. */
const cards = (access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${access.threadId} AND kind = 'merge_line' ORDER BY sequence`).map(
      (row) => JSON.parse(row.content) as { rows: ReadonlyArray<{ number: number; state: string; reason?: string }> },
    )
  })

const merge = (access: ToolAccess, args: Record<string, unknown>) => callTool(access, 'merge_pull_request', args)
const sweep = (access: ToolAccess) => Effect.flatMap(MergeLine, (line) => line.tick(access.projectId))

/** Takes an errand's step in a turn news started, as the coordinator does once woken. */
const takeStep = (access: ToolAccess, errand: string) =>
  Effect.gen(function* () {
    yield* turn(access, 'news', 'Althar’s merge line')
    return yield* merge(access, { errand, step: 'merge' })
  })

/** The runtime, the coordinator's agent signed out so a wake waits as news, and the line swept only by hand. */
const layer = (service: FakeService) =>
  runtime(
    ':memory:',
    {},
    { connectors: fakeConnectors({ github: service }), signedOut: ['claude-code'], mergeLineEvery: Duration.infinity },
  )

describe('sanity pass: the merge line and queue', () => {
  // Finding (sanity pass): a check that was cancelled counts as green in the merge line, so "merge once it's green" merges a
  // pull request whose test job never finished. Flips to passing when fixed.
  it.live.fails('a pull request with a cancelled check isn’t merged as green', () => {
    const { service, pull, set } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds').number
      // The unit job passed; the end-to-end job was cancelled (a newer run took its place, or someone cancelled it).
      set(`head-${number}`, 'passed', 'cancelled')
      const message = yield* turn(access, 'person')
      yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message })
      assert.deepStrictEqual(service.merged, [])
    }).pipe(Effect.provide(layer(service)))
  })

  // Finding (sanity pass): one that stepped out of line (its checks failed) comes back in ahead of the one whose merge is
  // already in flight, and is merged too: two merges in Althar's one slot at once, untested together. Flips to passing when fixed.
  it.live.fails('one that comes back in after its checks pass waits for the merge already in flight behind it', () => {
    const { service, pull, set } = host('gitlab')
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Retry refunds').number
      const second = pull('Cap retries').number
      set(`head-${first}`, 'failed')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }), /checks failed/)
      // The sweep steps the red one out of line, so the next goes ahead: GitLab's auto-merge is the line's merge.
      yield* sweep(access)
      assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /Auto-merge is on for MR !2/)
      // While MR !2 waits for its pipeline to auto-merge, MR !1's failed check passes on a rerun.
      set(`head-${first}`, 'passed')
      yield* sweep(access)
      const errand = (yield* errandsOf(access)).get(first)?.id ?? ''
      yield* takeStep(access, errand)
      // Only one merge is in flight in the line at a time: MR !1 waits for MR !2 to land, and is brought up to date after it.
      assert.deepStrictEqual(
        service.merged.map((one) => one.number),
        [second],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  // Finding (sanity pass): a head the lead pushed is merged as soon as the line reads it, before its checks have even
  // appeared: only Althar's own update of a branch is given time for its checks to start. Flips to passing when fixed.
  it.live.fails('a head its lead pushed waits for its checks to appear before it merges', () => {
    const { service, pull, set } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const access = yield* opened(working)
      const task = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Retry refunds' }),
        projectId: access.projectId,
        title: 'Retry refunds',
      })
      const pr = pull('Retry refunds')
      const number = pr.number
      const at = new Date().toISOString()
      const linkId = 'xlink_5a17000000000000000000000000000a'
      yield* sql`INSERT INTO external_links ${sql.insert({ id: linkId, projectId: access.projectId, taskId: task.taskId, connectionId: null, product: 'github', kind: 'change', externalId: String(number), ref: String(number), key: String(number), url: pr.url, snapshot: JSON.stringify({ number, title: pr.title, url: pr.url, state: 'open', draft: false, words: { noun: 'pull request', short: 'PR', prefix: '#' }, repository: ['meridian', 'api'] }), createdAt: at, updatedAt: at })}`
      set(`head-${number}`, 'failed')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }), /checks failed/)
      yield* sweep(access)
      // Its lead pushes a fix, as Althar records the lead's pushes; the host hasn't registered its checks yet.
      const fix = service.pushTo(number)
      set(fix)
      yield* sql`INSERT INTO observations ${sql.insert({ id: yield* newId(Ids.observation), projectId: access.projectId, subjectType: 'external_link', subjectId: linkId, kind: 'pushed', payload: JSON.stringify({ id: `pushed:${fix}`, sha: fix }), source: 'althar', observedAt: yield* timestamp })}`
      yield* sweep(access)
      yield* takeStep(access, (yield* errandsOf(access)).get(number)?.id ?? '')
      // Nothing is green yet at the lead's head: no checks ran on it, so it isn't merged.
      assert.deepStrictEqual(service.merged, [])
    }).pipe(Effect.provide(layer(service)))
  })

  /** One in GitHub's merge queue on the person's word, that the queue then takes out because its build with main failed. */
  const sentBackByTheQueue = (service: FakeService, access: ToolAccess, number: number) =>
    Effect.gen(function* () {
      service.mergeQueue()
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${number}`, head: `head-${number}`, message }), /merge queue at head-1/)
      // The queue's build of it with main failed: GitHub takes it out, its own head's checks still green.
      service.queueCommit(number, 'group-1')
      service.dequeue(number, 'checks')
      yield* sweep(access)
    })

  // Finding (sanity pass): one the merge queue sent back for failing checks is put straight back in at the same head:
  // the coordinator is woken to enqueue it again, though its task's lead is told putting it back is the person's.
  // Flips to passing when fixed.
  it.live.fails('one the merge queue sent back for its checks isn’t put back in at the same head', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds').number
      yield* sentBackByTheQueue(service, access, number)
      yield* takeStep(access, (yield* errandsOf(access)).get(number)?.id ?? '')
      // In the queue once, on the person's word: not again at the head whose build just failed.
      assert.deepStrictEqual(
        service.merged.map((one) => [one.number, one.how, one.head]),
        [[number, 'queue', `head-${number}`]],
      )
    }).pipe(Effect.provide(layer(service)))
  })

  // Finding (sanity pass): the line's card shows one the merge queue sent back for failing checks as queued, while it is
  // out of the queue. Flips to passing when fixed.
  it.live.fails('one the merge queue sent back for its checks is shown sent back on the line’s card, not queued', () => {
    const { service, pull } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const number = pull('Retry refunds').number
      yield* sentBackByTheQueue(service, access, number)
      assert.strictEqual((yield* cards(access))[0]?.rows[0]?.state, 'sent_back')
    }).pipe(Effect.provide(layer(service)))
  })

  // Finding (sanity pass): one whose checks failed takes the slot back whenever main moves: Althar merges main into its
  // branch and the next in line waits behind it again, though its card says it goes back in once its checks pass.
  // Flips to passing when fixed.
  it.live.fails('one whose checks failed at its head holds no slot when main moves: the next goes ahead', () => {
    const { service, pull, set } = host()
    const { working } = hosted(['meridian', 'api'])
    return Effect.gen(function* () {
      const access = yield* opened(working)
      const first = pull('Breaks the build').number
      const second = pull('Cap retries').number
      set(`head-${first}`, 'failed')
      const message = yield* turn(access, 'person')
      assert.match(yield* merge(access, { pull_request: `#${first}`, head: `head-${first}`, message }), /checks failed/)
      yield* sweep(access)
      assert.match((yield* cards(access))[0]?.rows[0]?.reason ?? '', /goes back in once they pass/)
      // Someone else merges into main; the second, behind it now, is next in line.
      service.writeTo('main')
      assert.match(yield* merge(access, { pull_request: `#${second}`, head: `head-${second}`, message }), /behind main/)
      yield* sweep(access)
      // The red one is still red at its head: the second is the one brought up to date.
      assert.include(service.updated, second)
    }).pipe(Effect.provide(layer(service)))
  })
})

describe('sanity pass: what the coordinator is told of a task’s pull request', () => {
  const change = (more: Partial<ChangeSummary> = {}): ChangeSummary => ({
    product: 'github',
    number: 113,
    title: 'Add a retry',
    url: 'https://github.com/acme/app/pull/113',
    state: 'open',
    draft: false,
    noun: 'pull request',
    short: 'PR',
    prefix: '#',
    repository: 'acme/app',
    slug: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    checks: { outcome: 'passed', passed: 2, failed: 0, running: 0, total: 2, failing: [], list: [] },
    head: 'abc',
    listening: true,
    localHead: 'abc',
    unpushed: 0,
    diverged: null,
    ...more,
  })

  // Finding (sanity pass): read_task told the coordinator a pull request's conflict was "not known (Althar does not ask the
  // host)" even where its host said it conflicts and the task's card showed the conflict. It says what the host said.
  it('says a pull request its host says conflicts conflicts, not that it isn’t known', () => {
    const section = sectionWords({
      changes: [
        { change: change({ conflicts: true, target: 'main' }), seenAt: '2026-10-01T10:00:00Z', host: { name: 'GitHub', connected: true } },
      ],
      merged: [],
      unmerged: 0,
    })
    assert.notMatch(section, /Conflicts with the base: not known/)
    assert.include(section, 'Conflicts with main, as its host says')
  })
})

describe('sanity pass: a task’s pull request Althar itself brought up to date', () => {
  /** How the host answers each update-branch Althar asks of it, in turn. */
  type Answer =
    /** It merges main in and says the head it made. */
    | 'said'
    /** It merges main in and answers before it has, as GitHub's can. */
    | 'background'
    /** It answers before it has, and what lands is someone else's merge of another branch at that head. */
    | 'theirs'
    /** It answers before it has, and main moves on again before it merges, so it merges main's newer head. */
    | 'advanced'

  /**
   * The fake GitHub over a bare repository, whose update-branch merges main into the pull request's branch there, as
   * GitHub's does: a merge commit on the branch, made on the host, never pushed from this Mac. It tells a head its update
   * made by its parents, as GitHub's does (`madeFrom`), and reads branches' heads from the bare repository.
   */
  const onGitHub = (answers: ReadonlyArray<Answer>) => {
    const { working, bare } = hosted()
    const fake = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    fake.addRepository(['meridian', 'api'])
    const byHost = (...args: Array<string>) => git(bare, '-c', 'user.name=GitHub', '-c', 'user.email=noreply@github.test', ...args)
    /** Someone else's commit lands on main, on the host. */
    const mainMoves = () => {
      const main = git(bare, 'rev-parse', 'refs/heads/main')
      git(bare, 'update-ref', 'refs/heads/main', byHost('commit-tree', `${main}^{tree}`, '-p', main, '-m', 'Elsewhere on main'))
    }
    let asked = 0
    const update = (_repository: Repository, change: ChangeRequest, ask: { readonly expectedHead: string }) =>
      Effect.sync((): BranchUpdate => {
        const answer = answers[asked++] ?? 'said'
        const head = git(bare, 'rev-parse', `refs/heads/${change.source}`)
        if (head !== ask.expectedHead) return { outcome: 'moved', head }
        if (answer === 'advanced') mainMoves()
        const main = git(bare, 'rev-parse', 'refs/heads/main')
        const other = byHost('commit-tree', `${main}^{tree}`, '-p', main, '-m', 'Other work')
        const merged = answer === 'theirs' ? other : main
        const made = byHost('commit-tree', `${head}^{tree}`, '-p', head, '-p', merged, '-m', `Merge into ${change.source}`)
        git(bare, 'update-ref', `refs/heads/${change.source}`, made)
        return { outcome: 'updated', head: answer === 'said' ? made : null }
      })
    const madeFrom = (_repository: Repository, change: ChangeRequest, from: string, base?: string) =>
      Effect.sync(() => {
        if (change.headSha === null) return false
        const parents = git(bare, 'rev-list', '--parents', '-n', '1', change.headSha).split(' ').slice(1)
        if (parents.length !== 2 || parents[0] !== from) return false
        const merged = parents[1] ?? ''
        // As GitHub's: main's head asked for, or a later one of main's, where it moved on before the merge.
        const ancestor = (earlier: string, later: string) => {
          try {
            git(bare, 'merge-base', '--is-ancestor', earlier, later)
            return true
          } catch {
            return false
          }
        }
        return base === undefined || merged === base || (ancestor(base, merged) && ancestor(merged, `refs/heads/${change.target}`))
      })
    const branchHead = (_repository: Repository, name: string) => Effect.sync(() => git(bare, 'rev-parse', `refs/heads/${name}`))
    // Everything as the fake answers it, but what reads and writes the bare repository.
    const own: Record<string, unknown> = { updateBranch: update, madeFrom, branchHead }
    const github = new Proxy(fake, {
      get: (target, key, receiver) => (typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key, receiver)),
    }) as FakeService & CodeHost
    return { working, bare, github, mainMoves }
  }

  /** What Althar's own course tells the lead: quiet, so its turn holds nothing for Ship. */
  const tell = (threadId: string, body: string) =>
    Effect.gen(function* () {
      yield* (yield* Sessions).send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, quiet: true })
    })

  // Finding (sanity pass): once Althar itself brought a task's pull request up to date (update_branch, as the merge line
  // does for each pull request behind main), it took the merge it made for someone else's push: the lead's next commits,
  // the merge brought in, were held for the person's Push as "Someone else pushed to PR #1". Now each update Althar makes is
  // kept, and read back once as the merge of main's head into the head it asked from (branchUpdates.ts), one after another;
  // what the lead commits on top of it goes up by itself, and someone else's merge in its place is still theirs.
  it.live.each([
    { how: 'its host says the head it made', answers: ['said'], ours: true },
    { how: 'its host makes it in the background', answers: ['background'], ours: true },
    { how: 'twice, the first in the background', answers: ['background', 'said'], ours: true },
    { how: 'someone else’s merge of another branch lands in its place', answers: ['theirs'], ours: false },
    { how: 'main moves on again before its host merges it', answers: ['advanced'], ours: true },
  ] satisfies ReadonlyArray<{ how: string; answers: ReadonlyArray<Answer>; ours: boolean }>)(
    'what the lead commits after Althar’s own update of its branch still goes up by itself: $how',
    ({ answers, ours }) => {
      const { bare, working, github, mainMoves } = onGitHub(answers)
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* connect('github', HOST)
        const projectId = yield* ask(
          working,
          'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:commit] [lead:push]',
        )
        const [ready] = yield* until(taskCards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
        const threadId = ready?.threadId ?? ''
        const [workspace] = yield* sql<{
          path: string
          branch: string
        }>`SELECT path, branch FROM workspaces WHERE task_id = ${ready?.taskId ?? ''}`
        const path = workspace?.path ?? ''
        const branch = workspace?.branch ?? ''
        // Main moves on, and Althar brings the pull request up to date with it on the host, as often as asked: GitHub's
        // update-branch. Each time, Althar reads the pull request at the head it lands at.
        for (const answer of answers) {
          mainMoves()
          assert.match(
            yield* updateBranch(projectId, { pull_request: '#1' }),
            answer === 'said' ? /^Merged main into PR #1's branch/ : /is merging main/,
          )
          const landed = git(bare, 'rev-parse', branch)
          yield* (yield* Changes).refresh(ready?.taskId ?? '')
          yield* until(taskCards(projectId), (all) => all[0]?.change?.head === landed)
        }
        // The lead brings what landed into its branch here, and commits on top in its next turn.
        const made = git(bare, 'rev-parse', branch)
        git(path, 'fetch', '-q', bare, branch)
        git(path, 'merge', '-q', '--ff-only', made)
        yield* tell(threadId, 'tidy pls')
        const [card] = yield* until(
          Effect.all([taskCards(projectId), Effect.sync(() => git(bare, 'log', '--format=%s', branch).split('\n'))]),
          ([all, log]) => all[0]?.change?.pushing?.held != null || log.includes('Tidy up'),
        ).pipe(Effect.map(([all]) => all))
        if (ours) {
          assert.isNull(card?.change?.pushing?.held ?? null)
          assert.include(git(bare, 'log', '--format=%s', branch).split('\n'), 'Tidy up')
        } else {
          assert.strictEqual(card?.change?.pushing?.held, 'Someone else pushed to PR #1')
          assert.notInclude(git(bare, 'log', '--format=%s', branch).split('\n'), 'Tidy up')
        }
      }).pipe(Effect.provide(runtimeWith({ github }, ':memory:', undefined, ['codex', 'opencode'])))
    },
  )
})
