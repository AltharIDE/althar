import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Logger } from 'effect'
import { TestClock } from 'effect/testing'

import { checkRunState, issueSearchOf, leftQueueOf, LISTING_KEPT_MS, makeGitHub, searchOf, statusesOf, tail } from '../src/github'
import {
  fromOutside,
  type Issue,
  type IssueChange,
  type IssuePage,
  type IssueQuery,
  type Repository,
  type StatusCategory,
} from '../src/model'
import { type Route, type Sent, stubFetch, variablesOf } from './stub'

const API = 'https://api.github.com'
const REPO = `${API}/repos/meridian/api`
const repository: Repository = {
  id: '7',
  path: ['meridian', 'api'],
  defaultBranch: 'main',
  webUrl: 'https://github.com/meridian/api',
  canPush: true,
  merges: ['squash', 'merge'],
}

const github = (routes: ReadonlyArray<Route>, apiUrl = API) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeGitHub({ fetch, apiUrl, webUrl: 'https://github.com', credential: Effect.succeed({ kind: 'bearer', token: 'ghu_t' }) }),
    sent,
  }
}

const pull = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  node_id: 'PR_1',
  number: 12,
  title: 'Rate-limit refunds',
  body: null,
  html_url: 'https://github.com/meridian/api/pull/12',
  state: 'open',
  draft: true,
  merged_at: null,
  head: { ref: 'althar/mer-231', sha: 'abc' },
  base: { ref: 'main' },
  user: { id: 5, login: 'you', type: 'User' },
  additions: 10,
  deletions: 2,
  changed_files: 3,
  updated_at: '2026-10-01T09:00:00Z',
  ...overrides,
})

describe('GitHub as a code host', () => {
  it.effect('says who it is signed in as, with GitHub’s headers', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['GET', `${API}/user`, { json: { id: 5, login: 'you', name: 'You' } }]])
      assert.deepStrictEqual(yield* host.account, { id: '5', login: 'you', name: 'You' })
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer ghu_t')
      assert.strictEqual(sent[0]?.headers['x-github-api-version'], '2022-11-28')
    }),
  )

  it.effect('reads a repository, and whether the account may push', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          REPO,
          {
            json: {
              id: 7,
              full_name: 'meridian/api',
              default_branch: 'trunk',
              html_url: 'https://github.com/meridian/api',
              permissions: { push: true },
              allow_squash_merge: true,
              allow_merge_commit: true,
              allow_rebase_merge: false,
            },
          },
        ],
        [
          'GET',
          `${API}/repos/meridian/web`,
          { json: { id: 8, full_name: 'meridian/web', default_branch: 'main', html_url: 'https://github.com/meridian/web' } },
        ],
      ])
      assert.deepStrictEqual(yield* host.repository(['meridian', 'api']), { ...repository, defaultBranch: 'trunk' })
      // Without push, GitHub doesn't say how it merges: a merge commit, as it would by default.
      const web = yield* host.repository(['meridian', 'web'])
      assert.isFalse(web.canPush)
      assert.deepStrictEqual(web.merges, ['merge'])
    }),
  )

  it.effect('says the account can push to a repository it was forked from only once its owners let it', () =>
    Effect.gen(function* () {
      const upstream = { id: 9, full_name: 'AltharIDE/althar', default_branch: 'main', html_url: 'https://github.com/AltharIDE/althar' }
      const before = github([
        ['GET', `${API}/repos/AltharIDE/althar`, { json: { ...upstream, permissions: { admin: false, push: false, pull: true } } }],
      ])
      assert.isFalse((yield* before.host.repository(['AltharIDE', 'althar'])).canPush)
      // Invited as a collaborator, GitHub says so on the same read.
      const after = github([
        ['GET', `${API}/repos/AltharIDE/althar`, { json: { ...upstream, permissions: { admin: false, push: true, pull: true } } }],
      ])
      assert.isTrue((yield* after.host.repository(['AltharIDE', 'althar'])).canPush)
    }),
  )

  it.effect('merges in the first way the repository allows, only the head it last saw, and says why it can’t', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['PUT', `${REPO}/pulls/12/merge`, { json: { merged: true, sha: 'merge-sha' } }],
        // GitHub's replica can still say open just after: what the merge answered is what counts.
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
      ])
      const open = yield* host.change(repository, 12)
      const merged = yield* host.merge(repository, open)
      assert.deepInclude(merged, { state: 'merged', number: 12, headSha: open.headSha, url: open.url })
      const asked = sent.find((request) => request.method === 'PUT')
      assert.deepStrictEqual(asked?.body, { merge_method: 'squash', sha: open.headSha })
      // Not read back: one read, before the merge.
      assert.strictEqual(sent.filter((request) => request.method === 'GET').length, 1)
      // Where GitHub doesn't say it merged, it is read back.
      const unsaid = github([
        ['PUT', `${REPO}/pulls/12/merge`, { json: {} }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ merged_at: '2026-10-01T12:00:00Z', state: 'closed' }) }],
      ])
      assert.strictEqual((yield* unsaid.host.merge(repository, open)).state, 'merged')
      assert.strictEqual(unsaid.sent.filter((request) => request.method === 'GET').length, 1)
      const refusing = github([
        ['PUT', `${REPO}/pulls/12/merge`, { status: 405, json: { message: 'Pull Request is not mergeable' } }],
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
      ])
      const refused = yield* Effect.flip(refusing.host.merge({ ...repository, merges: [] }, yield* refusing.host.change(repository, 12)))
      assert.deepInclude(refused, { reason: 'rejected', message: 'Pull Request is not mergeable' })
      assert.deepStrictEqual(refusing.sent.find((request) => request.method === 'PUT')?.body, {
        merge_method: 'merge',
        sha: open.headSha,
      })
    }),
  )

  it.effect('merges in the way asked, says whether a branch has a merge queue, and enters and leaves it at the head read', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['PUT', `${REPO}/pulls/12/merge`, { json: { merged: true } }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        [
          'POST',
          `${API}/graphql`,
          (request) => {
            const query = JSON.stringify(request.body)
            if (query.includes('mergeQueue(branch')) return { json: { data: { repository: { mergeQueue: { id: 'MQ_1' } } } } }
            if (query.includes('enqueuePullRequest'))
              return { json: { data: { enqueuePullRequest: { mergeQueueEntry: { position: 1 } } } } }
            if (query.includes('dequeuePullRequest')) return { json: { data: { dequeuePullRequest: { mergeQueueEntry: { id: 'E' } } } } }
            return {
              json: {
                data: { repository: { pullRequest: { isMergeQueueEnabled: true, isInMergeQueue: false, timelineItems: { nodes: [] } } } },
              },
            }
          },
        ],
      ])
      const open = yield* host.change(repository, 12)
      yield* host.merge(repository, open, { method: 'merge' })
      assert.deepStrictEqual(sent.find((request) => request.method === 'PUT')?.body, { merge_method: 'merge', sha: 'abc' })
      // GitHub's own auto-merge isn't how Althar merges.
      assert.strictEqual((yield* Effect.flip(host.merge(repository, open, { auto: true }))).reason, 'rejected')
      assert.deepStrictEqual(yield* host.mergeWays(repository, 'main'), { queue: 'merge_queue', autoMerge: false, server: null })
      assert.deepStrictEqual(variablesOf(sent.at(-1)), { owner: 'meridian', name: 'api', branch: 'main' })
      assert.deepInclude(yield* host.enqueue(repository, open), { state: 'open', queued: true })
      assert.deepStrictEqual(variablesOf(sent.at(-1)), { id: 'PR_1', head: 'abc' })
      // Not in it, as GitHub says, it is left as it is; nothing is dequeued.
      assert.deepInclude(yield* host.leaveQueue(repository, open), { queued: false })
      assert.isFalse(sent.some((request) => (JSON.stringify(request.body) ?? '').includes('dequeuePullRequest')))
      // A branch without one, and a server that can't say, have none.
      const none = github([['POST', `${API}/graphql`, { json: { data: { repository: { mergeQueue: null } } } }]])
      assert.isNull((yield* none.host.mergeWays(repository, 'main')).queue)
      const server = github([['POST', `${API}/graphql`, { json: { errors: [{ message: "Field 'mergeQueue' doesn't exist" }] } }]])
      assert.isNull((yield* server.host.mergeWays(repository, 'main')).queue)
    }),
  )

  it.effect('reads a branch’s head, whether a pull request has a commit, and whether a head is the merge its update made', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/branches/release/1.0`, { json: { commit: { sha: 'tip' } } }],
        ['GET', `${REPO}/compare/tip...abc`, { json: { behind_by: 0, ahead_by: 2 } }],
        ['GET', `${REPO}/compare/newer...abc`, { json: { behind_by: 3, ahead_by: 2 } }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['GET', `${REPO}/commits/made`, { json: { parents: [{ sha: 'abc' }, { sha: 'tip' }] } }],
        ['GET', `${REPO}/commits/theirs`, { json: { parents: [{ sha: 'made' }] } }],
      ])
      assert.strictEqual(yield* host.branchHead(repository, 'release/1.0'), 'tip')
      const open = yield* host.change(repository, 12)
      assert.isTrue(yield* host.contains(repository, open, 'tip'))
      assert.isFalse(yield* host.contains(repository, open, 'newer'))
      // Update-branch lands in the background: the head read later is its own only where it is a merge whose first parent is the head it had.
      assert.isTrue(yield* host.madeFrom!(repository, { ...open, headSha: 'made' }, 'abc'))
      assert.isFalse(yield* host.madeFrom!(repository, { ...open, headSha: 'theirs' }, 'abc'))
    }),
  )

  it.effect('puts a pull request in its branch’s merge queue where GitHub refuses a merge for one, and reads it there when asked', () =>
    Effect.gen(function* () {
      const queue = (pull: Record<string, unknown> = {}) => ({
        json: {
          data: {
            repository: { pullRequest: { isMergeQueueEnabled: true, isInMergeQueue: false, timelineItems: { nodes: [] }, ...pull } },
          },
        },
      })
      const enqueuing = (request: Sent) => JSON.stringify(request.body).includes('enqueuePullRequest')
      const refusal = { status: 405, json: { message: 'Repository rule violations found\n\nChanges must be made through the merge queue' } }
      const { host, sent } = github([
        ['PUT', `${REPO}/pulls/12/merge`, refusal],
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        [
          'POST',
          `${API}/graphql`,
          (request) => (enqueuing(request) ? { json: { data: { enqueuePullRequest: { mergeQueueEntry: { position: 1 } } } } } : queue()),
        ],
      ])
      const open = yield* host.change(repository, 12)
      // Refused for its queue, it goes in, at the head Althar saw, and is open still: GitHub merges it later.
      assert.deepInclude(yield* host.merge(repository, open), { state: 'open', queued: true, number: 12, headSha: 'abc' })
      const [asked, enqueued] = sent.filter((request) => request.method === 'POST')
      assert.deepStrictEqual(variablesOf(asked), { owner: 'meridian', name: 'api', number: 12 })
      assert.deepStrictEqual(variablesOf(enqueued), { id: 'PR_1', head: 'abc' })
      // In it already, as pressing Merge again finds it, it isn't put in twice.
      const already = github([
        ['PUT', `${REPO}/pulls/12/merge`, refusal],
        ['POST', `${API}/graphql`, queue({ isInMergeQueue: true })],
      ])
      assert.deepInclude(yield* already.host.merge(repository, open), { state: 'open', queued: true })
      assert.lengthOf(already.sent.filter(enqueuing), 0)
      // Refused on a branch with no queue, or where GitHub won't say, it is the refusal it was.
      for (const answer of [queue({ isMergeQueueEnabled: false }), { status: 502, json: {} }]) {
        const plain = github([
          ['PUT', `${REPO}/pulls/12/merge`, { status: 405, json: { message: 'Pull Request is not mergeable' } }],
          ['POST', `${API}/graphql`, answer],
        ])
        assert.deepInclude(yield* Effect.flip(plain.host.merge(repository, open)), {
          reason: 'rejected',
          message: 'Pull Request is not mergeable',
        })
        assert.lengthOf(plain.sent.filter(enqueuing), 0)
      }
      // Read, it says where it stands with the queue only when asked: out of it, why the queue took it out, and the merge-group commit it judged.
      const groupRun = (head_sha: string, number = 12) => ({
        head_sha,
        head_branch: `gh-readonly-queue/main/pr-${number}-abc`,
        event: 'merge_group',
        created_at: '2026-10-01T10:00:00Z',
      })
      const reading = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ timelineItems: { nodes: [{ reason: 'failed_checks', beforeCommit: { oid: 'queue-sha' } }] } })],
        ['GET', `${REPO}/actions/runs?event=merge_group&per_page=100`, { json: { workflow_runs: [groupRun('queue-sha')] } }],
      ])
      assert.notProperty(yield* reading.host.change(repository, 12), 'queued')
      assert.lengthOf(
        reading.sent.filter((request) => request.method === 'POST'),
        0,
      )
      assert.deepInclude(yield* reading.host.change(repository, 12, { queue: true }), {
        queued: false,
        leftQueue: 'checks',
        queueSha: 'queue-sha',
      })
      // Without its before commit, a sendback still says why, with none named.
      const unnamed = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ timelineItems: { nodes: [{ reason: 'failed_checks' }] } })],
        ['GET', `${REPO}/actions/runs?event=merge_group&per_page=100`, { json: { workflow_runs: [] } }],
      ])
      assert.deepInclude(yield* unnamed.host.change(repository, 12, { queue: true }), {
        queued: false,
        leftQueue: 'checks',
        queueSha: null,
      })
      // In it, the merge-group commit is its entry's head; one not yet read has none named.
      const inIt = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ isInMergeQueue: true, mergeQueueEntry: { headCommit: { oid: 'group-sha' } } })],
      ])
      assert.deepInclude(yield* inIt.host.change(repository, 12, { queue: true }), { queued: true, leftQueue: null, queueSha: 'group-sha' })
      const unread = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ isInMergeQueue: true })],
      ])
      assert.deepInclude(yield* unread.host.change(repository, 12, { queue: true }), { queued: true, leftQueue: null, queueSha: null })
      // While in it, the current entry wins over an older removal's commit.
      const againQueued = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        [
          'POST',
          `${API}/graphql`,
          queue({
            isInMergeQueue: true,
            mergeQueueEntry: { headCommit: { oid: 'current-group' } },
            timelineItems: { nodes: [{ reason: 'failed_checks', beforeCommit: { oid: 'stale-group' } }] },
          }),
        ],
      ])
      assert.deepInclude(yield* againQueued.host.change(repository, 12, { queue: true }), { queued: true, queueSha: 'current-group' })
      // A removal commit that is the pull request's own head isn't a queue build: the merge-group workflow runs name the build.
      const fallback = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ timelineItems: { nodes: [{ reason: 'failed_checks', beforeCommit: { oid: 'abc' } }] } })],
        [
          'GET',
          `${REPO}/actions/runs?event=merge_group&per_page=100`,
          { json: { workflow_runs: [groupRun('wrong-pr', 120), groupRun('group-sha')] } },
        ],
        ['GET', `${REPO}/commits/group-sha`, { json: { parents: [{ sha: 'base-sha' }, { sha: 'abc' }] } }],
      ])
      assert.deepInclude(yield* fallback.host.change(repository, 12, { queue: true }), {
        queued: false,
        leftQueue: 'checks',
        queueSha: 'group-sha',
      })
      // Some entry heads are the PR head too. While queued, an older build from before this enqueue must not win.
      const queuedHead = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        [
          'POST',
          `${API}/graphql`,
          queue({ isInMergeQueue: true, mergeQueueEntry: { enqueuedAt: '2026-10-01T09:59:00Z', headCommit: { oid: 'abc' } } }),
        ],
        [
          'GET',
          `${REPO}/actions/runs?event=merge_group&per_page=100`,
          { json: { workflow_runs: [{ ...groupRun('old-group'), created_at: '2026-10-01T09:00:00Z' }, groupRun('group-sha')] } },
        ],
        ['GET', `${REPO}/commits/group-sha`, { json: { parents: [{ sha: 'abc' }] } }],
      ])
      assert.deepInclude(yield* queuedHead.host.change(repository, 12, { queue: true }), { queued: true, queueSha: 'group-sha' })
      const deniedBuild = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ timelineItems: { nodes: [{ reason: 'failed_checks', beforeCommit: { oid: 'abc' } }] } })],
        ['GET', `${REPO}/actions/runs?event=merge_group&per_page=100`, { status: 403, json: { message: 'Actions read denied' } }],
      ])
      const denied = yield* deniedBuild.host.change(repository, 12, { queue: true })
      assert.isFalse(denied.queued)
      assert.isNull(denied.queueSha)
      assert.include(denied.queueError, '403')
      assert.include(denied.queueError, 'Actions read denied')
      // And where no run matches, none is named rather than the head.
      const noMatch = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ timelineItems: { nodes: [{ reason: 'failed_checks', beforeCommit: { oid: 'abc' } }] } })],
        ['GET', `${REPO}/actions/runs?event=merge_group&per_page=100`, { json: { workflow_runs: [groupRun('other-sha')] } }],
        ['GET', `${REPO}/commits/other-sha`, { json: { parents: [{ sha: 'base-sha' }] } }],
      ])
      assert.deepInclude(yield* noMatch.host.change(repository, 12, { queue: true }), {
        queued: false,
        leftQueue: 'checks',
        queueSha: null,
      })
      // A pull request GraphQL doesn't find, as REST did a moment before, on a branch known to have a queue, isn't taken for
      // one out of it.
      let found = true
      const unfound = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, () => (found ? queue({ isInMergeQueue: true }) : { json: { data: { repository: null } } })],
      ])
      yield* unfound.host.change(repository, 12, { queue: true })
      found = false
      assert.strictEqual((yield* Effect.flip(unfound.host.change(repository, 12, { queue: true }))).reason, 'not_found')
      // On a branch not known to have one, where GitHub fails to say, the read stands without, and the next read asks again.
      const unsaid = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, { status: 502, json: {} }],
      ])
      assert.notProperty(yield* unsaid.host.change(repository, 12, { queue: true }), 'queued')
      assert.notProperty(yield* unsaid.host.change(repository, 12, { queue: true }), 'queued')
      assert.lengthOf(
        unsaid.sent.filter((request) => request.method === 'POST'),
        2,
      )
      // Merged, there is no queue to ask about.
      const merged = github([['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-28T12:00:00Z' }) }]])
      assert.notProperty(yield* merged.host.change(repository, 12, { queue: true }), 'queued')
      // GitHub's reasons, in Althar's words; one it gives that Althar doesn't know is still a reason.
      assert.deepStrictEqual(['failed_checks', 'merge_conflict', 'manual', 'merged', 'timed_out', null].map(leftQueueOf), [
        'checks',
        'conflict',
        'removed',
        'merged',
        'other',
        null,
      ])
    }),
  )

  it.effect('closes a pull request unmerged, leaves one already closed as it is, and says why it can’t', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['PATCH', `${REPO}/pulls/12`, { json: pull({ state: 'closed' }) }],
      ])
      const closed = yield* host.closeChange(repository, yield* host.change(repository, 12))
      assert.strictEqual(closed.state, 'closed')
      assert.deepStrictEqual(sent.find((request) => request.method === 'PATCH')?.body, { state: 'closed' })
      // Merged meanwhile, it isn't touched: it says it is merged.
      const already = github([['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-02T00:00:00Z' }) }]])
      assert.strictEqual((yield* already.host.closeChange(repository, closed)).state, 'merged')
      assert.isFalse(already.sent.some((request) => request.method === 'PATCH'))
      // An account that can't push here is refused, in GitHub's words.
      const refusing = github([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['PATCH', `${REPO}/pulls/12`, { status: 403, json: { message: 'Resource not accessible by integration' } }],
      ])
      const refused = yield* Effect.flip(refusing.host.closeChange(repository, closed))
      assert.deepInclude(refused, { reason: 'forbidden', status: 403, message: 'Resource not accessible by integration' })
    }),
  )

  it.effect('gives a pull request another title or description, sending only what changes, and says why it can’t', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['PATCH', `${REPO}/pulls/12`, { json: pull({ title: 'The homepage opens on the orrery', body: 'Why it changed.' }) }],
      ])
      const pullChange = yield* host.change(repository, 12)
      const both = yield* host.editChange(repository, pullChange, {
        title: 'The homepage opens on the orrery',
        body: 'Why it changed.',
      })
      assert.strictEqual(both.title, 'The homepage opens on the orrery')
      assert.strictEqual(both.body, 'Why it changed.')
      assert.deepStrictEqual(sent.find((request) => request.method === 'PATCH')?.body, {
        title: 'The homepage opens on the orrery',
        body: 'Why it changed.',
      })
      // The title alone leaves the description as GitHub has it: it isn't sent.
      const titled = github([['PATCH', `${REPO}/pulls/12`, { json: pull({ title: 'Renamed' }) }]])
      yield* titled.host.editChange(repository, pullChange, { title: 'Renamed' })
      assert.deepStrictEqual(titled.sent[0]?.body, { title: 'Renamed' })
      const described = github([['PATCH', `${REPO}/pulls/12`, { json: pull({ body: 'Only this' }) }]])
      yield* described.host.editChange(repository, pullChange, { body: 'Only this' })
      assert.deepStrictEqual(described.sent[0]?.body, { body: 'Only this' })
      // A stacked change goes into another branch once the one below merges: only its base is sent.
      const based = github([['PATCH', `${REPO}/pulls/12`, { json: pull() }]])
      yield* based.host.editChange(repository, pullChange, { base: 'main' })
      assert.deepStrictEqual(based.sent[0]?.body, { base: 'main' })
      // An upstream the account can't push to refuses it, in GitHub's words.
      const refusing = github([['PATCH', `${REPO}/pulls/12`, { status: 403, json: { message: 'Resource not accessible by integration' } }]])
      assert.deepInclude(yield* Effect.flip(refusing.host.editChange(repository, pullChange, { title: 'Renamed' })), {
        reason: 'forbidden',
        status: 403,
        message: 'Resource not accessible by integration',
      })
    }),
  )

  it.effect('deletes a closed pull request’s branch where its head is, a fork’s too, and never an open one’s', () =>
    Effect.gen(function* () {
      const head = { ref: 'althar/mer-231', sha: 'abc', repo: { full_name: 'meridian/api' } }
      const { host, sent } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', head }) }],
        ['DELETE', `${REPO}/git/refs/heads/althar/mer-231`, { status: 204 }],
      ])
      const change = yield* host.change(repository, 12)
      yield* host.deleteBranch(repository, change)
      assert.deepStrictEqual(
        sent.map((request) => `${request.method} ${request.url}`),
        [`GET ${REPO}/pulls/12`, `GET ${REPO}/pulls/12`, `DELETE ${REPO}/git/refs/heads/althar/mer-231`],
      )
      // From a fork, the fork's branch goes; one already gone, as GitHub says when asked after, is nothing to do.
      const fork = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', head: { ...head, repo: { full_name: 'you/api' } } }) }],
        ['DELETE', `${API}/repos/you/api/git/refs/heads/althar/mer-231`, { status: 422, json: { message: 'Reference does not exist' } }],
        ['GET', `${API}/repos/you/api/git/ref/heads/althar/mer-231`, { status: 404, json: { message: 'Not Found' } }],
      ])
      yield* fork.host.deleteBranch(repository, change)
      assert.isTrue(fork.sent.some((request) => request.method === 'DELETE' && request.url.startsWith(`${API}/repos/you/api/`)))
      // A 422 for a branch still there (its default branch, a validation, throttling) is GitHub refusing, said in its words.
      const kept = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', head }) }],
        ['DELETE', `${REPO}/git/refs/heads/althar/mer-231`, { status: 422, json: { message: 'Cannot delete the default branch' } }],
        ['GET', `${REPO}/git/ref/heads/althar/mer-231`, { json: { ref: 'refs/heads/althar/mer-231', object: { sha: 'abc' } } }],
      ])
      const stays = yield* Effect.flip(kept.host.deleteBranch(repository, change))
      assert.deepInclude(stays, { reason: 'rejected', status: 422, message: 'Cannot delete the default branch' })
      // Still open, its branch stays: deleting it would close the pull request behind the person's back.
      const open = github([['GET', `${REPO}/pulls/12`, { json: pull({ head }) }]])
      const refused = yield* Effect.flip(open.host.deleteBranch(repository, change))
      assert.deepInclude(refused, { reason: 'rejected', message: 'PR #12 is still open, so its branch stays.' })
      assert.isFalse(open.sent.some((request) => request.method === 'DELETE'))
    }),
  )

  it.effect('finds the open pull request from a branch', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', /\/pulls\?state=open&head=meridian%3Aalthar%2Fmer-231$/, { json: [pull()] }],
        ['GET', /\/pulls\?state=open&head=meridian%3Aother$/, { json: [] }],
      ])
      const found = yield* host.findChange(repository, 'althar/mer-231')
      assert.deepStrictEqual(found, {
        id: 'PR_1',
        number: 12,
        title: 'Rate-limit refunds',
        body: '',
        url: 'https://github.com/meridian/api/pull/12',
        state: 'open',
        draft: true,
        source: 'althar/mer-231',
        target: 'main',
        headSha: 'abc',
        author: { id: '5', login: 'you', name: null, bot: false },
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        updatedAt: '2026-10-01T09:00:00Z',
      })
      assert.isNull(yield* host.findChange(repository, 'other'))
      assert.lengthOf(sent, 2)
    }),
  )

  it.effect('opens a draft pull request, or adopts the one already open from its branch', () =>
    Effect.gen(function* () {
      let opened = 0
      const { host, sent } = github([
        [
          'POST',
          `${REPO}/pulls`,
          () =>
            (opened += 1) === 1
              ? { status: 201, json: pull() }
              : {
                  status: 422,
                  json: {
                    message: 'Validation Failed',
                    errors: [{ message: 'A pull request already exists for meridian:althar/mer-231.' }],
                  },
                },
        ],
        ['GET', /\/pulls\?state=open&head=/, { json: [pull({ draft: false })] }],
      ])
      const change = { title: 'MER-231: Rate-limit refunds', body: 'Body', source: 'althar/mer-231', target: 'main', draft: true }
      assert.strictEqual((yield* host.openChange(repository, change)).number, 12)
      assert.deepStrictEqual(sent[0]?.body, {
        title: 'MER-231: Rate-limit refunds',
        body: 'Body',
        head: 'althar/mer-231',
        base: 'main',
        draft: true,
      })
      const adopted = yield* host.openChange(repository, change)
      assert.strictEqual(adopted.number, 12)
      assert.isFalse(adopted.draft)
    }),
  )

  it.effect('opens one from a fork’s branch into the repository it was forked from, and finds it by the fork’s owner', () =>
    Effect.gen(function* () {
      const fork: Repository = { ...repository, id: '9', path: ['you', 'api'], webUrl: 'https://github.com/you/api' }
      const { host, sent } = github([
        ['POST', `${REPO}/pulls`, { status: 201, json: pull() }],
        ['GET', /\/repos\/meridian\/api\/pulls\?state=open&head=you%3Aalthar%2Fmer-231$/, { json: [pull()] }],
      ])
      const change = { title: 'Rate-limit refunds', body: '', source: 'althar/mer-231', target: 'main', draft: false, from: fork }
      assert.strictEqual((yield* host.openChange(repository, change)).number, 12)
      assert.strictEqual((sent[0]?.body as { head: string } | undefined)?.head, 'you:althar/mer-231')
      assert.strictEqual((yield* host.findChange(repository, 'althar/mer-231', fork))?.number, 12)
    }),
  )

  it.effect('fails to open when GitHub refuses for another reason, or the one it says exists is gone', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'POST',
          `${REPO}/pulls`,
          { status: 422, json: { message: 'Validation Failed', errors: [{ message: 'No commits between main and x' }] } },
        ],
      ])
      const error = yield* Effect.flip(host.openChange(repository, { title: 't', body: '', source: 'x', target: 'main', draft: true }))
      assert.strictEqual(error.reason, 'rejected')
      const vanished = github([
        ['POST', `${REPO}/pulls`, { status: 422, json: { message: 'A pull request already exists' } }],
        ['GET', /\/pulls\?state=open&head=/, { json: [] }],
      ])
      assert.strictEqual(
        (yield* Effect.flip(vanished.host.openChange(repository, { title: 't', body: '', source: 'x', target: 'main', draft: true })))
          .reason,
        'rejected',
      )
    }),
  )

  it.effect('reads a pull request’s state: merged, closed, open', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-02T00:00:00Z', user: null }) }],
        ['GET', `${REPO}/pulls/13`, { json: pull({ number: 13, state: 'closed', draft: undefined, additions: undefined }) }],
      ])
      const merged = yield* host.change(repository, 12)
      assert.strictEqual(merged.state, 'merged')
      assert.isNull(merged.author)
      const closed = yield* host.change(repository, 13)
      assert.strictEqual(closed.state, 'closed')
      assert.isFalse(closed.draft)
      assert.isNull(closed.additions)
    }),
  )

  it.effect('says when a pull request conflicts with its target, once GitHub has worked it out', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ mergeable: false, mergeable_state: 'dirty' }) }],
        ['GET', `${REPO}/pulls/13`, { json: pull({ number: 13, mergeable: true, mergeable_state: 'blocked' }) }],
        ['GET', `${REPO}/pulls/14`, { json: pull({ number: 14, mergeable: null, mergeable_state: 'unknown' }) }],
        ['GET', `${REPO}/pulls/15`, { json: pull({ number: 15 }) }],
      ])
      assert.isTrue((yield* host.change(repository, 12)).conflicts)
      // Blocked by a rule is not a conflict.
      assert.isFalse((yield* host.change(repository, 13)).conflicts)
      // Still working it out, or not said at all, as in a list: nothing is claimed.
      assert.notProperty(yield* host.change(repository, 14), 'conflicts')
      assert.notProperty(yield* host.change(repository, 15), 'conflicts')
    }),
  )

  it.effect('marks a draft ready through GraphQL, on github.com and on an instance', () =>
    Effect.gen(function* () {
      const cloud = github([
        ['POST', 'https://api.github.com/graphql', { json: { data: { markPullRequestReadyForReview: { pullRequest: { id: 'PR_1' } } } } }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
      ])
      const ready = yield* cloud.host.markReady(repository, { ...(yield* cloud.host.change(repository, 12)), draft: true, id: 'PR_1' })
      assert.isFalse(ready.draft)
      assert.deepStrictEqual(variablesOf(cloud.sent.find((request) => request.method === 'POST')), {
        id: 'PR_1',
      })
      const instance = github(
        [
          ['POST', 'https://git.meridian.dev/api/graphql', { json: { data: {} } }],
          ['GET', 'https://git.meridian.dev/api/v3/repos/meridian/api/pulls/12', { json: pull({ draft: false }) }],
        ],
        'https://git.meridian.dev/api/v3/',
      )
      assert.isFalse((yield* instance.host.markReady(repository, { ...(yield* cloud.host.change(repository, 12)), id: 'PR_1' })).draft)
    }),
  )

  it('reads a check run’s state', () => {
    assert.strictEqual(checkRunState('queued', null), 'queued')
    assert.strictEqual(checkRunState('in_progress', null), 'running')
    assert.strictEqual(checkRunState('completed', 'success'), 'passed')
    assert.strictEqual(checkRunState('completed', 'failure'), 'failed')
    assert.strictEqual(checkRunState('completed', 'timed_out'), 'failed')
    assert.strictEqual(checkRunState('completed', 'skipped'), 'skipped')
    assert.strictEqual(checkRunState('completed', 'cancelled'), 'cancelled')
    assert.strictEqual(checkRunState('completed', 'neutral'), 'neutral')
    assert.strictEqual(checkRunState('completed', 'stale'), 'neutral')
  })

  it.effect('reads checks from check runs and commit statuses alike', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          `${REPO}/commits/abc/check-runs?per_page=100`,
          {
            json: {
              check_runs: [
                {
                  id: 1,
                  name: 'test',
                  status: 'completed',
                  conclusion: 'failure',
                  html_url: 'https://x/1',
                  output: { title: '2 failed' },
                  app: { slug: 'github-actions' },
                },
                { id: 2, name: 'lint', status: 'in_progress', details_url: 'https://x/2', app: null },
              ],
            },
          },
        ],
        [
          'GET',
          `${REPO}/commits/abc/status?per_page=100`,
          {
            json: {
              statuses: [
                { id: 3, context: 'ci/circle', state: 'success', target_url: 'https://c/3', description: 'Passed' },
                { id: 4, context: 'deploy', state: 'pending' },
                { id: 5, context: 'security', state: 'error' },
              ],
            },
          },
        ],
      ])
      assert.deepStrictEqual(yield* host.checks(repository, 'abc'), [
        { id: 'run:1:github-actions', name: 'test', state: 'failed', url: 'https://x/1', summary: '2 failed' },
        { id: 'run:2:', name: 'lint', state: 'running', url: 'https://x/2', summary: null },
        { id: 'status:3', name: 'ci/circle', state: 'passed', url: 'https://c/3', summary: 'Passed' },
        { id: 'status:4', name: 'deploy', state: 'running', url: null, summary: null },
        { id: 'status:5', name: 'security', state: 'failed', url: null, summary: null },
      ])
    }),
  )

  it.effect('reads a commit’s statuses alone where check runs are refused, as a fine-grained token’s are', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          `${REPO}/commits/abc/check-runs?per_page=100`,
          { status: 403, json: { message: 'Resource not accessible by personal access token' } },
        ],
        ['GET', `${REPO}/commits/abc/status?per_page=100`, { json: { statuses: [{ id: 3, context: 'ci/circle', state: 'success' }] } }],
      ])
      assert.deepStrictEqual(yield* host.checks(repository, 'abc'), [
        { id: 'status:3', name: 'ci/circle', state: 'passed', url: null, summary: null },
      ])
      assert.deepInclude(yield* Effect.flip(host.checks(repository, 'abc', { strict: true })), {
        reason: 'forbidden',
        status: 403,
        message: 'Resource not accessible by personal access token',
      })
      // Anything else that keeps check runs from being read still fails the checks.
      const limited = github([
        [
          'GET',
          `${REPO}/commits/abc/check-runs?per_page=100`,
          { status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } },
        ],
      ])
      assert.strictEqual((yield* Effect.flip(limited.host.checks(repository, 'abc'))).reason, 'rate_limited')
    }),
  )

  it.effect('reads every page of a commit’s check runs and commit statuses', () =>
    Effect.gen(function* () {
      const run = (id: number) => ({ id, name: `job-${id}`, status: 'completed', conclusion: id === 101 ? 'failure' : 'success' })
      const status = (id: number) => ({ id, context: `ci/${id}`, state: 'success' })
      const hundred = <A>(from: number, make: (id: number) => A) => Array.from({ length: 100 }, (_, index) => make(from + index))
      const { host } = github([
        ['GET', `${REPO}/commits/abc/check-runs?per_page=100`, { json: { check_runs: hundred(1, run) } }],
        ['GET', `${REPO}/commits/abc/check-runs?per_page=100&page=2`, { json: { check_runs: [run(101)] } }],
        ['GET', `${REPO}/commits/abc/status?per_page=100`, { json: { statuses: hundred(1, status) } }],
        ['GET', `${REPO}/commits/abc/status?per_page=100&page=2`, { json: { statuses: [status(101)] } }],
      ])
      const checks = yield* host.checks(repository, 'abc')
      assert.lengthOf(checks, 202)
      assert.deepInclude(
        checks.find((check) => check.id === 'run:101:'),
        { name: 'job-101', state: 'failed' },
      )
      assert.deepInclude(
        checks.find((check) => check.id === 'status:101'),
        { name: 'ci/101', state: 'passed' },
      )
    }),
  )

  it.effect('reads the end of a GitHub Actions job’s log from the storage GitHub redirects to, without the token', () =>
    Effect.gen(function* () {
      const long = Array.from({ length: 400 }, (_, n) => `2026-10-18T19:42:01.0000000Z line ${n}`).join('\n')
      // As GitHub answers: a 302 to the log in its storage, signed for a minute, which refuses a request that carries a token too.
      const blob = 'https://productionresultssa0.blob.core.windows.net/actions-results/abc/logs/job/job-logs.txt?sv=2025-01-05&sig=x'
      const { host, sent } = github([
        ['GET', `${REPO}/actions/jobs/1/logs`, { status: 302, headers: { location: blob } }],
        [
          'GET',
          blob,
          (request) =>
            request.headers.authorization === undefined
              ? { text: long }
              : { status: 400, text: '\uFEFF<?xml version="1.0"?><Error><Code>InvalidAuthenticationInfo</Code></Error>' },
        ],
      ])
      const check = { name: 'verify', state: 'failed' as const, url: null, summary: null }
      const log = yield* host.checkLog(repository, { ...check, id: 'run:1:github-actions' })
      assert.strictEqual(log?.split('\n').length, 150)
      assert.isTrue(log?.endsWith('line 399'))
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer ghu_t')
      assert.strictEqual(sent[1]?.url, blob)
      assert.isUndefined(sent[1]?.headers.authorization)
      assert.isUndefined(sent[1]?.headers['x-github-api-version'])
      // With `whole`, all of it.
      assert.strictEqual((yield* host.checkLog(repository, { ...check, id: 'run:1:github-actions' }, true))?.split('\n').length, 400)
    }),
  )

  it.effect('says why a GitHub Actions job’s log can’t be read, and reads nothing for other checks', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/actions/jobs/9/logs`, { status: 410, json: { message: 'Gone' } }],
        ['GET', `${REPO}/actions/jobs/7/logs`, { status: 403, json: { message: 'Resource not accessible by personal access token' } }],
        ['GET', `${REPO}/actions/jobs/6/logs`, { status: 302, headers: { location: 'https://storage.example/log?sig=old' } }],
        ['GET', 'https://storage.example/log?sig=old', { status: 403, text: '<Error><Code>AuthenticationFailed</Code></Error>' }],
        ['GET', `${REPO}/actions/jobs/8/logs`, { status: 500, text: 'down' }],
      ])
      const check = { name: 'test', state: 'failed' as const, url: null, summary: null }
      const failed = (id: string) => Effect.flip(host.checkLog(repository, { ...check, id }))
      assert.strictEqual((yield* failed('run:9:github-actions')).reason, 'not_found')
      const refused = yield* failed('run:7:github-actions')
      assert.strictEqual(refused.reason, 'forbidden')
      assert.strictEqual(refused.message, 'Resource not accessible by personal access token')
      // The storage's own XML isn't words: where it was, and what it answered, are.
      const storage = yield* failed('run:6:github-actions')
      assert.strictEqual(storage.reason, 'rejected')
      assert.strictEqual(storage.message, 'storage.example answered 403')
      assert.strictEqual((yield* failed('run:8:github-actions')).reason, 'unreachable')
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'status:3' }))
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'run:2:circleci' }))
    }),
  )

  it.effect('reads what a check run from another service reported of itself', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/check-runs/2`, { json: { output: { title: '1 new alert', summary: 'SQL injection', text: 'in src/db.ts:12' } } }],
        ['GET', `${REPO}/check-runs/3`, { json: { output: { title: 'Failed', summary: null, text: '' } } }],
      ])
      const check = { name: 'CodeQL', state: 'failed' as const, url: null, summary: null }
      assert.strictEqual(
        yield* host.checkReport!(repository, { ...check, id: 'run:2:github-advanced-security' }),
        'SQL injection\n\nin src/db.ts:12',
      )
      assert.isNull(yield* host.checkReport!(repository, { ...check, id: 'run:3:circleci' }))
      assert.isNull(yield* host.checkReport!(repository, { ...check, id: 'status:4' }))
    }),
  )

  it('keeps at most a few thousand characters of a log', () => {
    assert.lengthOf(tail('x'.repeat(20_000)), 12_000)
  })

  it.effect('reads what was said on a pull request since a cursor, oldest first', () =>
    Effect.gen(function* () {
      const user = (login: string, type = 'User') => ({ id: login.length, login, type })
      const { host, sent } = github([
        [
          'GET',
          /\/issues\/12\/comments\?per_page=100/,
          {
            json: [
              {
                id: 30,
                user: user('dana'),
                author_association: 'COLLABORATOR',
                body: 'Seconds or a date?',
                updated_at: '2026-10-01T10:05:00Z',
                html_url: 'https://c/30',
              },
              { id: 31, user: user('ci[bot]', 'Bot'), author_association: 'NONE', body: null, updated_at: '2026-10-01T10:01:00Z' },
            ],
          },
        ],
        [
          'GET',
          /\/pulls\/12\/comments\?per_page=100/,
          {
            json: [
              {
                id: 40,
                user: user('dana'),
                author_association: 'MEMBER',
                body: 'Here',
                updated_at: '2026-10-01T10:02:00Z',
                path: 'src/limit.ts',
                line: 14,
              },
              {
                id: 41,
                user: null,
                body: 'Reply',
                updated_at: '2026-10-01T10:03:00Z',
                path: 'src/limit.ts',
                original_line: 14,
                in_reply_to_id: 40,
              },
            ],
          },
        ],
        [
          'GET',
          /\/pulls\/12\/reviews\?per_page=100$/,
          {
            json: [
              {
                id: 50,
                user: user('dana'),
                author_association: 'OWNER',
                body: 'Fix the header',
                state: 'CHANGES_REQUESTED',
                submitted_at: '2026-10-01T10:04:00Z',
              },
              { id: 51, user: user('lee'), body: '', state: 'COMMENTED', submitted_at: '2026-10-01T10:06:00Z' },
              { id: 52, user: user('lee'), body: 'Old', state: 'APPROVED', submitted_at: '2026-10-01T09:00:00Z' },
              { id: 53, user: user('lee'), body: '', state: 'PENDING', submitted_at: null },
              {
                id: 54,
                user: user('kim'),
                author_association: 'FIRST_TIME_CONTRIBUTOR',
                body: 'Nice',
                state: 'COMMENTED',
                submitted_at: '2026-10-01T10:07:00Z',
              },
            ],
          },
        ],
      ])
      const activity = yield* host.activity(repository, 12, '2026-10-01T10:00:00Z')
      assert.include(sent[0]?.url, 'since=2026-10-01T10%3A00%3A00Z')
      assert.deepStrictEqual(
        activity.comments.map((comment) => [
          comment.id,
          comment.author.login,
          comment.author.bot,
          comment.member,
          comment.threadId,
          comment.line,
        ]),
        [
          ['31', 'ci[bot]', true, false, null, null],
          ['40', 'dana', false, true, '40', 14],
          ['41', 'ghost', false, false, '40', 14],
          ['30', 'dana', false, true, null, null],
        ],
      )
      assert.deepStrictEqual(
        activity.reviews.map((review) => [review.id, review.verdict, review.member]),
        [
          ['50', 'changes_requested', true],
          ['54', 'commented', false],
        ],
      )
      assert.strictEqual(activity.cursor, '2026-10-01T10:07:00Z')
    }),
  )

  it.effect('reads every page of a pull request’s comments, line comments and reviews', () =>
    Effect.gen(function* () {
      const at = '2026-10-01T10:00:00Z'
      const user = { id: 5, login: 'you', type: 'User' }
      const comment = (id: number) => ({ id, user, author_association: 'MEMBER', body: `Comment ${id}`, updated_at: at })
      const line = (id: number) => ({ ...comment(id), path: 'src/limit.ts', line: 3 })
      const review = (id: number) => ({
        id,
        user,
        author_association: 'MEMBER',
        body: `Review ${id}`,
        state: 'APPROVED',
        submitted_at: at,
      })
      const hundred = <A>(from: number, make: (id: number) => A) => Array.from({ length: 100 }, (_, index) => make(from + index))
      const { host, sent } = github([
        ['GET', `${REPO}/issues/12/comments?per_page=100`, { json: hundred(1, comment) }],
        ['GET', `${REPO}/issues/12/comments?per_page=100&page=2`, { json: [comment(101)] }],
        ['GET', `${REPO}/pulls/12/comments?per_page=100`, { json: hundred(201, line) }],
        ['GET', `${REPO}/pulls/12/comments?per_page=100&page=2`, { json: [line(301)] }],
        ['GET', `${REPO}/pulls/12/reviews?per_page=100`, { json: hundred(401, review) }],
        ['GET', `${REPO}/pulls/12/reviews?per_page=100&page=2`, { json: [review(501)] }],
      ])
      const activity = yield* host.activity(repository, 12, null)
      // A hundred on each first page, and the rest of each on its second.
      assert.lengthOf(activity.comments, 202)
      assert.lengthOf(activity.reviews, 101)
      const ids = activity.comments.map((one) => Number(one.id))
      assert.includeMembers(ids, [101, 301])
      assert.strictEqual(new Set(ids).size, 202)
      assert.includeMembers(
        activity.reviews.map((one) => one.id),
        ['501'],
      )
      // Three lists, each followed to its second page and no further.
      assert.strictEqual(sent.filter((request) => request.url.includes('page=2')).length, 3)
      assert.isFalse(sent.some((request) => request.url.includes('page=3')))
    }),
  )

  for (const permission of ['admin', 'maintain', 'write', 'read', 'none', 'triage']) {
    it.effect(`checks base repository access for comments and reviews: ${permission}`, () =>
      Effect.gen(function* () {
        const author = { id: 9, login: 'maintainer' }
        const comment = { id: 1, user: author, author_association: 'CONTRIBUTOR', body: 'Fix', updated_at: '2026-10-01T10:00:00Z' }
        const { host, sent } = github([
          ['GET', /\/issues\/12\/comments/, { json: [comment, { ...comment, id: 2, author_association: 'NONE' }] }],
          ['GET', /\/pulls\/12\/comments/, { json: [comment] }],
          ['GET', /\/pulls\/12\/reviews/, { json: [{ ...comment, state: 'APPROVED', submitted_at: comment.updated_at }] }],
          ['GET', `${REPO}/collaborators/maintainer/permission`, { json: { permission } }],
        ])
        const expected = ['admin', 'maintain', 'write'].includes(permission)
        const activity = yield* host.activity(repository, 12, null)
        assert.deepStrictEqual(
          activity.comments.map((row) => row.member),
          [expected, expected, expected],
        )
        assert.strictEqual(activity.reviews[0]?.member, expected)
        yield* host.activity(repository, 12, null)
        assert.lengthOf(
          sent.filter((call) => call.url.endsWith('/permission')),
          1,
        )
        yield* TestClock.adjust(Duration.minutes(5))
        yield* host.activity(repository, 12, null)
        assert.lengthOf(
          sent.filter((call) => call.url.endsWith('/permission')),
          2,
        )
      }),
    )
  }

  for (const status of [401, 403, 404, 429, 500]) {
    it.effect(`falls back to association when permissions answer ${status}`, () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          [
            'GET',
            /\/issues\/12\/comments/,
            {
              json: ['CONTRIBUTOR', 'NONE', 'MEMBER', 'OWNER', 'COLLABORATOR'].map((association, id) => ({
                id,
                user: { id, login: `person${id}` },
                author_association: association,
                updated_at: '2026-10-01T10:00:00Z',
              })),
            },
          ],
          ['GET', /\/pulls\/12\/comments/, { json: [] }],
          ['GET', /\/pulls\/12\/reviews/, { json: [] }],
          ['GET', /\/permission$/, { status }],
        ])
        const logged: unknown[] = []
        const logger = Logger.make(({ message }) => logged.push(message))
        const activity = yield* host.activity(repository, 12, null).pipe(Effect.provide(Logger.layer([logger])))
        yield* host.activity(repository, 12, null).pipe(Effect.provide(Logger.layer([logger])))
        assert.lengthOf(logged, status === 404 ? 0 : 1)
        assert.deepStrictEqual(
          activity.comments.map((row) => row.member),
          [false, false, true, true, true],
        )
        assert.lengthOf(
          sent.filter((call) => call.url.endsWith('/permission')),
          2,
        )
      }),
    )
  }

  for (const failure of ['network', 'invalid response']) {
    it.effect(`keeps activity when permission lookup has ${failure}`, () =>
      Effect.gen(function* () {
        const stub = stubFetch([
          [
            'GET',
            /\/issues\/12\/comments/,
            { json: [{ id: 1, user: { id: 1, login: 'person' }, author_association: 'NONE', updated_at: '2026-10-01T10:00:00Z' }] },
          ],
          ['GET', /\/pulls\/12\/comments/, { json: [] }],
          ['GET', /\/pulls\/12\/reviews/, { json: [] }],
        ])
        const host = makeGitHub({
          apiUrl: API,
          webUrl: 'https://github.com',
          credential: Effect.succeed({ kind: 'bearer', token: 'test' }),
          fetch: (url, init) => {
            if (url.endsWith('/permission')) {
              if (failure === 'network') return Promise.reject(new Error('offline'))
              return Promise.resolve(new Response('{}'))
            }
            return stub.fetch(url, init)
          },
        })
        const activity = yield* host.activity(repository, 12, null)
        assert.lengthOf(activity.comments, 1)
        assert.isFalse(activity.comments[0]?.member)
      }),
    )
  }

  it.effect('does not query permissions for bots', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'GET',
          /\/issues\/12\/comments/,
          {
            json: [
              { id: 1, user: { id: 1, login: 'ci[bot]' }, author_association: 'NONE', updated_at: '2026-10-01T10:00:00Z' },
              { id: 2, user: { id: 2, login: 'automation', type: 'Bot' }, author_association: 'NONE', updated_at: '2026-10-01T10:00:00Z' },
            ],
          },
        ],
        ['GET', /\/pulls\/12\/comments/, { json: [] }],
        ['GET', /\/pulls\/12\/reviews/, { json: [] }],
      ])
      const activity = yield* host.activity(repository, 12, null)
      assert.deepStrictEqual(
        activity.comments.map((row) => row.member),
        [false, false],
      )
      assert.lengthOf(sent, 3)
    }),
  )

  it.effect('reads everything said, from the start, without a cursor', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', /\/issues\/12\/comments/, { json: [] }],
        ['GET', /\/pulls\/12\/comments/, { json: [] }],
        ['GET', /\/pulls\/12\/reviews/, { json: [{ id: 1, user: null, state: 'APPROVED', submitted_at: '2026-10-01T09:00:00Z' }] }],
      ])
      const activity = yield* host.activity(repository, 12, null)
      assert.notInclude(sent[0]?.url, 'since')
      assert.strictEqual(activity.reviews[0]?.verdict, 'approved')
      assert.strictEqual(activity.cursor, '2026-10-01T09:00:00Z')
    }),
  )

  it.effect('replies in a line’s thread, or in the conversation', () =>
    Effect.gen(function* () {
      const answer = { id: 60, user: { id: 5, login: 'you' }, body: 'Done', updated_at: '2026-10-01T11:00:00Z' }
      const { host, sent } = github([
        ['POST', `${REPO}/pulls/12/comments/40/replies`, { status: 201, json: { ...answer, path: 'src/limit.ts', in_reply_to_id: 40 } }],
        ['POST', `${REPO}/issues/12/comments`, { status: 201, json: answer }],
      ])
      assert.strictEqual((yield* host.reply(repository, 12, { body: 'Done', threadId: '40' })).threadId, '40')
      assert.isNull((yield* host.reply(repository, 12, { body: 'Done', threadId: null })).threadId)
      assert.deepStrictEqual(sent[0]?.body, { body: 'Done' })
    }),
  )

  it.effect('reads a pull request to review: whether its author is one of the repository’s people, and the fork it comes from', () =>
    Effect.gen(function* () {
      const base = { ref: 'main', sha: 'b45e', repo: { full_name: 'meridian/api' } }
      const { host } = github([
        // A collaborator's branch of the repository's own: from inside.
        [
          'GET',
          `${REPO}/pulls/12`,
          {
            json: pull({
              head: { ref: 'fix', sha: 'abc', repo: { full_name: 'Meridian/API' } },
              base,
              author_association: 'COLLABORATOR',
              user: { id: 9, login: 'ana', type: 'User' },
            }),
          },
        ],
        // A first contribution, from a fork: outside twice over.
        [
          'GET',
          `${REPO}/pulls/13`,
          {
            json: pull({
              number: 13,
              head: { ref: 'send-back', sha: 'd4c8ae4', repo: { full_name: 'ninemate/api' } },
              base,
              author_association: 'FIRST_TIME_CONTRIBUTOR',
              user: { id: 10, login: 'ninemate', type: 'User' },
            }),
          },
        ],
        // A member's branch on a fork GitHub no longer has: a fork, with no path.
        [
          'GET',
          `${REPO}/pulls/14`,
          { json: pull({ number: 14, head: { ref: 'gone', sha: 'e1', repo: null }, base, author_association: 'MEMBER' }) },
        ],
        // An answer that says neither, as an older GitHub's might: from inside, by nobody named.
        ['GET', `${REPO}/pulls/15`, { json: pull({ number: 15 }) }],
      ])
      const inside = yield* host.changeToReview(repository, 12)
      assert.deepInclude(inside, { number: 12, member: true, fork: null, baseSha: 'b45e', headSha: 'abc', additions: 10, deletions: 2 })
      assert.isFalse(fromOutside(inside))
      const outside = yield* host.changeToReview(repository, 13)
      assert.deepInclude(outside, { member: false, baseSha: 'b45e', headSha: 'd4c8ae4' })
      assert.deepStrictEqual(outside.fork, ['ninemate', 'api'])
      assert.strictEqual(outside.author?.login, 'ninemate')
      assert.isTrue(fromOutside(outside))
      const gone = yield* host.changeToReview(repository, 14)
      assert.deepStrictEqual([gone.member, gone.fork], [true, []])
      assert.isTrue(fromOutside(gone))
      const unsaid = yield* host.changeToReview(repository, 15)
      assert.deepStrictEqual([unsaid.member, unsaid.fork, unsaid.baseSha], [false, null, null])
    }),
  )

  it.effect('posts a review with its verdict, its summary and its comments on lines, of the commit it read', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'POST',
          `${REPO}/pulls/13/reviews`,
          { json: { id: 801, html_url: 'https://github.com/meridian/api/pull/13#pullrequestreview-801', state: 'CHANGES_REQUESTED' } },
        ],
        ['POST', `${REPO}/pulls/14/reviews`, { json: { id: 802 } }],
        [
          'POST',
          `${REPO}/pulls/15/reviews`,
          { status: 422, json: { message: 'Pull request review thread line must be part of the diff' } },
        ],
      ])
      const posted = yield* host.postReview(repository, 13, {
        event: 'request_changes',
        body: 'Needs a test.',
        commit: 'd4c8ae4',
        comments: [{ path: 'src/limit.ts', line: 7, body: 'Refunds skip this.' }],
      })
      assert.deepStrictEqual(posted, { id: '801', url: 'https://github.com/meridian/api/pull/13#pullrequestreview-801' })
      assert.deepStrictEqual(sent[0]?.body, {
        commit_id: 'd4c8ae4',
        body: 'Needs a test.',
        event: 'REQUEST_CHANGES',
        comments: [{ path: 'src/limit.ts', line: 7, side: 'RIGHT', body: 'Refunds skip this.' }],
      })
      // Of the head as GitHub has it, an approval with no comments; GitHub giving no link, none is made up.
      assert.deepStrictEqual(yield* host.postReview(repository, 14, { event: 'approve', body: 'Good.', commit: null, comments: [] }), {
        id: '802',
        url: null,
      })
      assert.deepStrictEqual(sent[1]?.body, { body: 'Good.', event: 'APPROVE', comments: [] })
      // A line the change doesn't touch is GitHub's to refuse, in its words.
      const refused = yield* Effect.flip(
        host.postReview(repository, 15, {
          event: 'comment',
          body: 'A thought.',
          commit: null,
          comments: [{ path: 'a', line: 1, body: 'b' }],
        }),
      )
      assert.deepInclude(refused, { reason: 'rejected', message: 'Pull request review thread line must be part of the diff' })
      assert.deepInclude(sent[2]?.body, { event: 'COMMENT' })
    }),
  )

  it.effect('pushes over HTTPS with the token, never the person’s own credentials', () =>
    Effect.gen(function* () {
      const { host } = github([])
      const target = yield* host.pushTarget(repository)
      assert.strictEqual(target.url, 'https://github.com/meridian/api.git')
      assert.strictEqual(target.header, `Authorization: Basic ${Buffer.from('x-access-token:ghu_t').toString('base64')}`)
    }),
  )
})

/*
 * GitHub's answers to the list's search, as its GraphQL API gives them: one
 * of Althar's own drafts with checks running, an outside contributor's from a
 * fork with changes asked for, an app's, and a merged one. Written out by
 * hand in the shape GitHub documents, not recorded from a live call.
 */
const listed = (overrides: Record<string, unknown> = {}) => ({
  id: 'PR_kwDO12',
  number: 12,
  title: 'Rate-limit refunds',
  url: 'https://github.com/meridian/api/pull/12',
  state: 'OPEN',
  isDraft: true,
  headRefName: 'althar/mer-231',
  baseRefName: 'main',
  headRefOid: 'abc',
  updatedAt: '2026-10-13T09:00:00Z',
  isCrossRepository: false,
  headRepositoryOwner: { login: 'meridian' },
  author: { __typename: 'User', login: 'you', databaseId: 5, name: 'You' },
  reviewDecision: null,
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
  ...overrides,
})

const SEARCHED = {
  data: {
    search: {
      issueCount: 41,
      nodes: [
        listed(),
        listed({
          id: 'PR_kwDO13',
          number: 13,
          title: 'Send back won’t restart a dead lead',
          url: 'https://github.com/meridian/api/pull/13',
          isDraft: false,
          headRefName: 'send-back',
          isCrossRepository: true,
          headRepositoryOwner: { login: 'ninemate' },
          author: { __typename: 'User', login: 'ninemate', databaseId: 10, name: null },
          reviewDecision: 'CHANGES_REQUESTED',
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
        }),
        listed({
          id: 'PR_kwDO14',
          number: 14,
          title: 'Bump effect',
          isDraft: false,
          author: { __typename: 'Bot', login: 'dependabot', databaseId: 49699333 },
          reviewDecision: 'APPROVED',
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        }),
        listed({
          id: 'PR_kwDO9',
          number: 9,
          state: 'MERGED',
          isDraft: false,
          reviewDecision: 'REVIEW_REQUIRED',
          author: null,
          commits: { nodes: [] },
        }),
        // An issue the search found: none of a pull request's fields, so it is left out.
        {},
      ],
    },
  },
}

describe('GitHub listing pull requests', () => {
  it('asks its search for the repository’s pull requests, narrowed as asked, each word quoted', () => {
    assert.strictEqual(searchOf(['meridian', 'api'], { state: 'open', limit: 30 }), 'repo:meridian/api is:pr is:open sort:updated-desc')
    assert.strictEqual(
      searchOf(['meridian', 'api'], {
        state: 'closed',
        author: '@ninemate',
        text: 'send "back',
        reviewRequested: true,
        draft: false,
        limit: 5,
      }),
      'repo:meridian/api is:pr is:closed is:unmerged author:ninemate review-requested:@me draft:false "send" "back" in:title sort:updated-desc',
    )
    assert.strictEqual(
      searchOf(['meridian', 'api'], { state: 'merged', author: 'dependabot[bot]', limit: 5 }),
      'repo:meridian/api is:pr is:merged author:app/dependabot sort:updated-desc',
    )
    // Reading on past a listing: those updated at or before the last it gave, to the second, as search reads times.
    assert.strictEqual(
      searchOf(['meridian', 'api'], { state: 'open', draft: false, updatedUntil: '2026-10-21T08:00:05.123Z', limit: 100 }),
      'repo:meridian/api is:pr is:open draft:false updated:<=2026-10-21T08:00:05Z sort:updated-desc',
    )
    // A qualifier in the words is only a word.
    assert.strictEqual(
      searchOf(['meridian', 'api'], { state: 'all', text: 'repo:other/x', limit: 5 }),
      'repo:meridian/api is:pr "repo:other/x" in:title sort:updated-desc',
    )
    // No login could be that: nothing is asked.
    assert.isUndefined(searchOf(['meridian', 'api'], { state: 'open', author: 'a b repo:x', limit: 5 }))
  })

  it.effect('lists them in one call, with their reviews, checks and forks, and says there are more', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['POST', `${API}/graphql`, { json: SEARCHED }]])
      const list = yield* host.listChanges(repository, { state: 'all', author: 'ninemate', limit: 4 })
      assert.deepStrictEqual(variablesOf(sent[0]), { q: 'repo:meridian/api is:pr author:ninemate sort:updated-desc', n: 4 })
      assert.isTrue(list.more)
      assert.deepStrictEqual(
        list.changes.map((change) => [
          change.number,
          change.state,
          change.draft,
          change.author?.login,
          change.forkOwner,
          change.reviewDecision,
          change.checks,
        ]),
        [
          [12, 'open', true, 'you', null, null, 'running'],
          [13, 'open', false, 'ninemate', 'ninemate', 'changes_requested', 'failed'],
          [14, 'open', false, 'dependabot[bot]', null, 'approved', null],
          [9, 'merged', false, undefined, null, 'review_required', null],
        ],
      )
      assert.deepInclude(list.changes[1], {
        title: 'Send back won’t restart a dead lead',
        url: 'https://github.com/meridian/api/pull/13',
        source: 'send-back',
        target: 'main',
        body: '',
        updatedAt: '2026-10-13T09:00:00Z',
      })
      assert.isTrue(list.changes[2]?.author?.bot)
      // Asked for as many as it has, it says there are none more.
      const all = github([['POST', `${API}/graphql`, { json: { data: { search: { issueCount: 1, nodes: [listed()] } } } }]])
      assert.isFalse((yield* all.host.listChanges(repository, { state: 'open', limit: 500 })).more)
      assert.deepInclude(variablesOf(all.sent[0]), { n: 100 })
    }),
  )

  it.effect('answers the same search again within a minute from memory, and asks again after', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['POST', `${API}/graphql`, { json: SEARCHED }]])
      const asked = { state: 'open', author: 'ninemate', limit: 30 } as const
      const first = yield* host.listChanges(repository, asked)
      yield* TestClock.adjust(Duration.millis(LISTING_KEPT_MS - 1))
      assert.deepStrictEqual(yield* host.listChanges(repository, asked), first)
      assert.lengthOf(sent, 1)
      // Narrowed otherwise, it is another search.
      yield* host.listChanges(repository, { ...asked, draft: true })
      assert.lengthOf(sent, 2)
      yield* TestClock.adjust(Duration.millis(1))
      yield* host.listChanges(repository, asked)
      assert.lengthOf(sent, 3)
    }),
  )

  it.effect('names the permission it lacks where GitHub refuses, and asks nothing for a login that can’t be one', () =>
    Effect.gen(function* () {
      const refusing = github([
        [
          'POST',
          `${API}/graphql`,
          {
            json: {
              data: null,
              errors: [
                { type: 'INSUFFICIENT_SCOPES', message: 'Your token has not been granted the required scopes to execute this query.' },
              ],
            },
          },
        ],
      ])
      const refused = yield* Effect.flip(refusing.host.listChanges(repository, { state: 'open', limit: 30 }))
      assert.deepInclude(refused, { reason: 'forbidden', scope: 'repo (a fine-grained token’s Pull requests: Read)' })
      const { host, sent } = github([])
      assert.deepInclude(yield* Effect.flip(host.listChanges(repository, { state: 'open', author: 'x y', limit: 30 })), {
        reason: 'rejected',
      })
      assert.lengthOf(sent, 0)
    }),
  )
})

describe('GitHub as a tracker', () => {
  const issue = (overrides: Record<string, unknown> = {}) => ({
    id: 900,
    node_id: 'I_900',
    number: 12,
    title: 'Refunds ignore the rate limit',
    body: 'They should not.',
    html_url: 'https://github.com/meridian/api/issues/12',
    state: 'open',
    assignees: [{ id: 5, login: 'you' }],
    labels: ['bug', { name: 'payments' }, { name: null }],
    updated_at: '2026-10-01T08:00:00Z',
    ...overrides,
  })

  describe('changing an issue', () => {
    const open: Issue = {
      id: '900',
      ref: 'meridian/api#12',
      key: '#12',
      title: 'Refunds ignore the rate limit',
      body: '',
      url: 'https://github.com/meridian/api/issues/12',
      status: { name: 'Open', category: 'todo' },
      priority: null,
      assignees: [],
      labels: ['bug'],
      container: 'meridian/api',
      updatedAt: '2026-10-01T08:00:00Z',
    }

    it('changes all but the fields GitHub’s issues haven’t, files one with its people, milestone and type, and takes several people', () => {
      const { capabilities } = github([]).host
      assert.deepStrictEqual(capabilities.changes, [
        'status',
        'close',
        'assignee',
        'labels',
        'project',
        'milestone',
        'parent',
        'type',
        'title',
        'description',
      ])
      assert.deepStrictEqual(capabilities.creates, ['assignee', 'milestone', 'type'])
      assert.strictEqual(capabilities.assignees, 'many')
    })

    it.effect('offers open and closed, the repository’s labels, its people and its open milestones, page after page', () =>
      Effect.gen(function* () {
        const labels = Array.from({ length: 100 }, (_, index) => ({ name: `label-${index}` }))
        const { host } = github([
          ['GET', `${REPO}/labels?per_page=100&page=1`, { json: labels }],
          ['GET', `${REPO}/labels?per_page=100&page=2`, { json: [{ name: 'payments' }] }],
          [
            'GET',
            `${REPO}/assignees?per_page=100&page=1`,
            {
              json: [
                { id: 5, login: 'you', name: 'You Person' },
                { id: 6, login: 'sam' },
              ],
            },
          ],
          ['GET', `${REPO}/milestones?state=open&per_page=100&page=1`, { json: [{ number: 3, title: 'Q4 launch' }] }],
        ])
        assert.deepStrictEqual(
          (yield* host.choices(open, 'status')).map((one) => one.name),
          ['Open', 'Closed', 'Closed as not planned'],
        )
        assert.lengthOf(yield* host.choices(open, 'labels'), 101)
        assert.deepStrictEqual(yield* host.choices(open, 'assignee'), [
          { id: 'you', name: 'You Person', also: ['you'] },
          { id: 'sam', name: 'sam', also: ['sam'] },
        ])
        assert.deepStrictEqual(yield* host.choices(open, 'milestone'), [{ id: '3', name: 'Q4 launch' }])
      }),
    )

    it.effect(
      'offers, for an issue about to be filed, the repository’s milestones, its owner’s open boards and its organisation’s types',
      () =>
        Effect.gen(function* () {
          const boards = [
            { id: 'PVT_1', number: 1, title: 'Roadmap', closed: false },
            { id: 'PVT_2', number: 2, title: 'Old roadmap', closed: true },
            null,
          ]
          const { host, sent } = github([
            ['GET', `${REPO}/milestones?state=open&per_page=100&page=1`, { json: [{ number: 3, title: 'Q4 launch' }] }],
            ['POST', `${API}/graphql`, { json: { data: { repositoryOwner: { projectsV2: { nodes: boards } } } } }],
            [
              'GET',
              `${API}/orgs/meridian/issue-types`,
              {
                json: [
                  { id: 1, name: 'Bug', is_enabled: true },
                  { id: 2, name: 'Feature' },
                  { id: 3, name: 'Spike', is_enabled: false },
                ],
              },
            ],
            ['GET', `${API}/orgs/you/issue-types`, { status: 404, json: { message: 'Not Found' } }],
          ])
          assert.deepStrictEqual(yield* host.choicesIn('meridian/api', 'milestone'), [{ id: '3', name: 'Q4 launch' }])
          assert.deepStrictEqual(yield* host.choicesIn('meridian/api', 'project'), [{ id: 'PVT_1', name: 'Roadmap' }])
          assert.include(JSON.stringify(sent[1]?.body), 'projectsV2')
          assert.deepStrictEqual(variablesOf(sent[1]), { owner: 'meridian' })
          assert.deepStrictEqual(yield* host.choicesIn('meridian/api', 'type'), [
            { id: 'Bug', name: 'Bug' },
            { id: 'Feature', name: 'Feature' },
          ])
          // A user's repository has no types: said in words, not as an empty list.
          const none = yield* Effect.flip(host.choicesIn('you/dotfiles', 'type'))
          assert.strictEqual(none.reason, 'rejected')
          assert.strictEqual(
            none.message,
            'Althar can’t change an issue’s type here: GitHub’s issue types are an organisation’s, and you isn’t one: its repositories’ issues have none',
          )
          const asked = sent.length
          assert.strictEqual((yield* Effect.flip(host.choicesIn('meridian', 'labels'))).message, 'Not a GitHub repository: meridian')
          for (const field of ['cycle', 'components'] as const)
            assert.strictEqual((yield* Effect.flip(host.choicesIn('meridian/api', field))).reason, 'rejected')
          assert.lengthOf(sent, asked)
        }),
    )

    it.effect(
      'edits its title, description, state, milestone and type at once, puts people on and others off, changes labels, and reads it back',
      () =>
        Effect.gen(function* () {
          const { host, sent } = github([
            ['PATCH', `${REPO}/issues/12`, { json: issue() }],
            ['POST', `${REPO}/issues/12/assignees`, { status: 201, json: issue() }],
            ['DELETE', `${REPO}/issues/12/assignees`, { json: issue() }],
            ['POST', `${REPO}/issues/12/labels`, { json: [] }],
            ['DELETE', `${REPO}/issues/12/labels/needs%20triage`, { status: 404, json: { message: 'Label does not exist' } }],
            [
              'GET',
              `${REPO}/issues/12`,
              {
                json: issue({
                  state: 'closed',
                  state_reason: 'not_planned',
                  milestone: { number: 3, title: 'Q4 launch' },
                  type: { name: 'Bug' },
                }),
              },
            ],
          ])
          const changed = yield* host.update(open, {
            title: 'Refunds, rate-limited',
            description: 'Rate-limit them as charges are.',
            status: { id: 'not_planned', name: 'Closed as not planned' },
            assignee: { add: [{ id: 'sam', name: 'sam' }], remove: [{ id: 'you', name: 'You' }] },
            milestone: { id: '3', name: 'Q4 launch' },
            type: { id: 'Bug', name: 'Bug' },
            labels: { add: [{ id: 'payments', name: 'payments' }], remove: [{ id: 'needs triage', name: 'needs triage' }] },
          })
          assert.strictEqual(changed.status.category, 'cancelled')
          assert.deepStrictEqual([changed.milestone, changed.type], [{ id: '3', name: 'Q4 launch' }, 'Bug'])
          assert.deepStrictEqual(sent[0]?.body, {
            title: 'Refunds, rate-limited',
            body: 'Rate-limit them as charges are.',
            state: 'closed',
            state_reason: 'not_planned',
            milestone: 3,
            type: 'Bug',
          })
          // People go on and come off by name: whoever else is on it stays.
          assert.deepStrictEqual(
            sent.slice(1, 3).map((request) => [request.method, request.url, request.body]),
            [
              ['POST', `${REPO}/issues/12/assignees`, { assignees: ['sam'] }],
              ['DELETE', `${REPO}/issues/12/assignees`, { assignees: ['you'] }],
            ],
          )
          assert.deepStrictEqual(sent[3]?.body, { labels: ['payments'] })
          // Someone put on alone edits nothing else.
          const adding = github([
            ['POST', `${REPO}/issues/12/assignees`, { status: 201, json: issue() }],
            ['GET', `${REPO}/issues/12`, { json: issue() }],
          ])
          yield* adding.host.update(open, { assignee: { add: [{ id: 'sam', name: 'sam' }], remove: [] } })
          assert.deepStrictEqual(
            adding.sent.map((request) => request.method),
            ['POST', 'GET'],
          )
        }),
    )

    it.effect('closes it as done, takes its assignees and milestone off, and refuses a priority before asking anything', () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          ['PATCH', `${REPO}/issues/12`, { json: issue() }],
          ['GET', `${REPO}/issues/12`, { json: issue({ state: 'closed', state_reason: 'completed', milestone: null, type: null }) }],
        ])
        const closed = yield* host.update(open, { close: true, assignee: null, milestone: null })
        assert.deepStrictEqual(sent[0]?.body, { state: 'closed', state_reason: 'completed', assignees: [], milestone: null })
        assert.deepStrictEqual([closed.milestone, closed.type], [null, null])
        const reopening = github([
          ['PATCH', `${REPO}/issues/12`, { json: issue() }],
          ['GET', `${REPO}/issues/12`, { json: issue() }],
        ])
        yield* reopening.host.update(open, { status: { id: 'open', name: 'Open' } })
        assert.deepStrictEqual(reopening.sent[0]?.body, { state: 'open' })
        const refusing = github([])
        assert.strictEqual((yield* Effect.flip(refusing.host.update(open, { priority: 'low' }))).reason, 'rejected')
        assert.lengthOf(refusing.sent, 0)
      }),
    )

    it.effect('refuses, in words, the fields GitHub’s issues haven’t, and taking one out of its parent, before asking anything', () =>
      Effect.gen(function* () {
        const { host, sent } = github([])
        const refused = (change: IssueChange) =>
          Effect.map(Effect.flip(host.update(open, change)), (error) => [error.reason, error.message])
        assert.deepStrictEqual(yield* refused({ due: '2026-11-30' }), [
          'rejected',
          'Althar can’t change an issue’s due here: GitHub’s issues have no due date; a project board’s date field is the board’s own',
        ])
        assert.deepStrictEqual(yield* refused({ parent: null }), [
          'rejected',
          'Althar can’t change an issue’s parent here: it can put a GitHub issue under another, but not yet take one out of its parent',
        ])
        for (const change of [
          { cycle: { id: 'c', name: 'Cycle 4' } },
          { estimate: 3 },
          { components: [{ id: 'api', name: 'API' }] },
          { title: 'Fine', priority: 'low' as const },
        ]) {
          const [reason, message] = yield* refused(change)
          assert.strictEqual(reason, 'rejected')
          assert.include(message, 'GitHub’s issues have no')
        }
        assert.lengthOf(sent, 0)
      }),
    )

    it.effect('puts it on a project board by its node id, leaving the others it is on, and takes it off every board', () =>
      Effect.gen(function* () {
        const routes: ReadonlyArray<Route> = [
          ['GET', `${REPO}/issues/12`, { json: issue() }],
          [
            'POST',
            `${API}/graphql`,
            (request) =>
              JSON.stringify(request.body).includes('projectItems')
                ? {
                    json: {
                      data: {
                        repository: {
                          issue: {
                            projectItems: {
                              nodes: [
                                { id: 'PVTI_1', project: { id: 'PVT_1' } },
                                { id: 'PVTI_2', project: { id: 'PVT_2' } },
                              ],
                            },
                          },
                        },
                      },
                    },
                  }
                : { json: { data: {} } },
          ],
        ]
        const on = github(routes)
        yield* on.host.update(open, { project: { id: 'PVT_1', name: 'Roadmap' } })
        const [added, ...more] = on.sent.filter((request) => request.method === 'POST')
        assert.include(JSON.stringify(added?.body), 'addProjectV2ItemById')
        assert.deepStrictEqual(variablesOf(added), { project: 'PVT_1', content: 'I_900' })
        assert.lengthOf(more, 0)
        // A board is no field of the issue's own: nothing is patched.
        assert.notInclude(
          on.sent.map((request) => request.method),
          'PATCH',
        )
        const off = github(routes)
        yield* off.host.update(open, { project: null })
        const [items, ...deleted] = off.sent.filter((request) => request.method === 'POST')
        assert.deepStrictEqual(variablesOf(items), { owner: 'meridian', name: 'api', number: 12 })
        assert.deepStrictEqual(deleted.map(variablesOf), [
          { project: 'PVT_1', item: 'PVTI_1' },
          { project: 'PVT_2', item: 'PVTI_2' },
        ])
        assert.isTrue(deleted.every((request) => JSON.stringify(request.body).includes('deleteProjectV2Item')))
      }),
    )

    it.effect('puts it under a parent issue, on the parent’s repository, in place of any it had; again, it is there already', () =>
      Effect.gen(function* () {
        const parent = { id: '400', ref: 'meridian/web#4', key: '#4' }
        const { host, sent } = github([
          ['POST', `${API}/repos/meridian/web/issues/4/sub_issues`, { status: 201, json: {} }],
          ['GET', `${REPO}/issues/12`, { json: issue() }],
        ])
        yield* host.update(open, { parent })
        assert.deepStrictEqual(
          [sent[0]?.method, sent[0]?.url, sent[0]?.body],
          ['POST', `${API}/repos/meridian/web/issues/4/sub_issues`, { sub_issue_id: 900, replace_parent: true }],
        )
        const again = github([
          [
            'POST',
            `${API}/repos/meridian/web/issues/4/sub_issues`,
            { status: 422, json: { message: 'Validation Failed: Issue may not contain duplicate sub-issues' } },
          ],
          ['GET', `${REPO}/issues/12`, { json: issue() }],
        ])
        assert.strictEqual((yield* again.host.update(open, { parent })).ref, 'meridian/api#12')
        const nowhere = github([])
        assert.strictEqual((yield* Effect.flip(nowhere.host.update(open, { parent: { ...parent, ref: 'MER-4' } }))).reason, 'not_found')
        assert.lengthOf(nowhere.sent, 0)
      }),
    )
  })

  it.effect('reads an issue by owner/repo#number', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/issues/12`, { json: issue() }],
        [
          'GET',
          `${REPO}/issues/13`,
          { json: issue({ number: 13, state: 'closed', state_reason: 'completed', body: null, assignees: null, labels: undefined }) },
        ],
        ['GET', `${REPO}/issues/14`, { json: issue({ number: 14, state: 'closed', state_reason: 'not_planned' }) }],
      ])
      const open = yield* host.issue('meridian/api#12')
      assert.deepStrictEqual(open, {
        id: '900',
        ref: 'meridian/api#12',
        key: '#12',
        title: 'Refunds ignore the rate limit',
        body: 'They should not.',
        url: 'https://github.com/meridian/api/issues/12',
        status: { name: 'Open', category: 'todo' },
        priority: null,
        assignees: [{ id: '5', login: 'you', name: null, bot: false }],
        labels: ['bug', 'payments'],
        container: 'meridian/api',
        updatedAt: '2026-10-01T08:00:00Z',
      })
      const done = yield* host.issue('meridian/api#13')
      assert.strictEqual(done.status.category, 'done')
      assert.deepStrictEqual([done.body, done.assignees, done.labels], ['', [], []])
      assert.strictEqual((yield* host.issue('meridian/api#14')).status.category, 'cancelled')
      assert.strictEqual((yield* Effect.flip(host.issue('MER-231'))).reason, 'not_found')
    }),
  )

  it.effect('reads its milestone and its type, none where it has none, and leaves them out where GitHub says nothing of them', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/issues/12`, { json: issue({ milestone: { number: 3, title: 'Q4 launch' }, type: { name: 'Bug' } }) }],
        ['GET', `${REPO}/issues/13`, { json: issue({ number: 13, milestone: null, type: null }) }],
        ['GET', `${REPO}/issues/14`, { json: issue({ number: 14 }) }],
      ])
      const typed = yield* host.issue('meridian/api#12')
      assert.deepStrictEqual([typed.milestone, typed.type], [{ id: '3', name: 'Q4 launch' }, 'Bug'])
      const plain = yield* host.issue('meridian/api#13')
      assert.deepStrictEqual([plain.milestone, plain.type], [null, null])
      const unsaid = yield* host.issue('meridian/api#14')
      assert.isFalse('milestone' in unsaid || 'type' in unsaid)
    }),
  )

  it.effect(
    'finds issues by GitHub’s search, newest change first: in a repository, or else those that involve the account, narrowed as asked',
    () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          ['GET', `${API}/user`, { json: { id: 5, login: 'you' } }],
          [
            'GET',
            /\/search\/issues\?/,
            {
              json: {
                total_count: 2,
                items: [issue({ repository_url: 'https://api.github.com/repos/meridian/web' }), issue({ number: 15, pull_request: {} })],
              },
            },
          ],
        ])
        const searched = () => {
          const request = sent.at(-1)
          assert.strictEqual(request?.url.startsWith(`${API}/search/issues?`), true)
          return Object.fromEntries(new URL(request?.url ?? '').searchParams)
        }
        const everywhere = yield* host.find({ state: 'open', limit: 5 })
        assert.deepStrictEqual(
          everywhere.issues.map((found) => found.ref),
          ['meridian/web#12'],
        )
        // All it found are on this page.
        assert.isNull(everywhere.next)
        assert.deepStrictEqual(searched(), { q: 'is:issue involves:you is:open', sort: 'updated', order: 'desc', per_page: '5' })
        const here = yield* host.find({ container: 'meridian/api', state: 'closed', text: 'rate "limit"', mine: true, limit: 500 })
        assert.strictEqual(here.issues[0]?.ref, 'meridian/api#12')
        assert.deepStrictEqual(searched(), {
          q: 'is:issue repo:meridian/api is:closed assignee:@me "rate" "limit" in:title,body',
          sort: 'updated',
          order: 'desc',
          per_page: '100',
        })
        // Those assigned to the account are bound already: the account isn't asked who it is.
        yield* host.find({ state: 'all', mine: true, limit: 10 })
        assert.strictEqual(searched().q, 'is:issue assignee:@me')
        assert.lengthOf(
          sent.filter((request) => request.url === `${API}/user`),
          1,
        )
        const asked = sent.length
        assert.strictEqual((yield* Effect.flip(host.find({ container: 'meridian', state: 'open', limit: 5 }))).reason, 'not_found')
        assert.lengthOf(sent, asked)
      }),
  )

  describe('narrowing a search', () => {
    const query = (narrowed: Partial<IssueQuery> = {}): IssueQuery => ({ container: 'meridian/api', state: 'all', limit: 10, ...narrowed })
    const status = (names: ReadonlyArray<string>, categories: ReadonlyArray<StatusCategory> = []) => ({ names, categories })

    it('says labels, a milestone, a parent, when it last changed and who it is assigned to in GitHub’s qualifiers, quoted', () => {
      assert.strictEqual(
        issueSearchOf(query({ labels: ['bug', 'needs "triage"'], milestone: 'Q4 launch', updatedSince: '2026-11-01' }), ''),
        'is:issue repo:meridian/api label:"bug" label:"needs triage" milestone:"Q4 launch" updated:>=2026-11-01',
      )
      // A number is in the repository searched; a ref is where it says.
      assert.strictEqual(issueSearchOf(query({ parent: '#3' }), ''), 'is:issue repo:meridian/api parent-issue:meridian/api#3')
      assert.strictEqual(issueSearchOf(query({ parent: 'meridian/web#4' }), ''), 'is:issue repo:meridian/api parent-issue:meridian/web#4')
      assert.isNull(issueSearchOf({ state: 'all', limit: 10, parent: '#3' }, 'you'))
      assert.isNull(issueSearchOf(query({ parent: 'MER-3' }), ''))
      assert.strictEqual(issueSearchOf(query({ assignee: null }), ''), 'is:issue repo:meridian/api no:assignee')
      // Taken as a login, unless GitHub said whose it is.
      assert.strictEqual(issueSearchOf(query({ assignee: '@Sam' }), ''), 'is:issue repo:meridian/api assignee:Sam')
      assert.strictEqual(
        issueSearchOf(query({ assignee: 'Sam Rivera' }), '', { assignee: 'sam' }),
        'is:issue repo:meridian/api assignee:sam',
      )
      assert.isNull(issueSearchOf(query({ assignee: 'nobody' }), '', { assignee: null }))
      assert.strictEqual(
        issueSearchOf(query({ project: 'Roadmap' }), '', { project: 'meridian/1' }),
        'is:issue repo:meridian/api project:meridian/1',
      )
      assert.isNull(issueSearchOf(query({ project: 'Roadmap' }), '', { project: null }))
      assert.isNull(issueSearchOf(query({ project: 'Roadmap' }), ''))
    })

    it('finds GitHub’s three statuses by their names or categories, as its search can say each set of them', () => {
      const searched = (asked: Partial<IssueQuery>) =>
        issueSearchOf(query(asked), '')?.replace('is:issue repo:meridian/api', '').trim() ?? null
      assert.deepStrictEqual(statusesOf({ state: 'all', status: status(['OPEN', 'cancelled']) }), ['open', 'not_planned'])
      assert.deepStrictEqual(statusesOf({ state: 'all', status: status([], ['done', 'started']) }), ['completed'])
      assert.deepStrictEqual(statusesOf({ state: 'all', status: status(['In Review'], ['backlog']) }), [])
      assert.strictEqual(searched({ status: status([], ['todo']) }), 'is:open')
      assert.strictEqual(searched({ status: status(['Closed']) }), 'is:closed -reason:"not planned"')
      assert.strictEqual(searched({ status: status(['not planned']) }), 'is:closed reason:"not planned"')
      assert.strictEqual(searched({ status: status(['open', 'done']) }), '-reason:"not planned"')
      assert.strictEqual(searched({ status: status(['open'], ['cancelled']) }), '-reason:completed')
      assert.strictEqual(searched({ status: status([], ['done', 'cancelled']) }), 'is:closed')
      assert.strictEqual(searched({ status: status(['Open', 'Closed', 'Closed as not planned']) }), '')
      assert.isNull(searched({ status: status(['In Review']) }))
      // With the state it is asked in: open and done is none.
      assert.strictEqual(searched({ state: 'closed', status: status(['open', 'done']) }), 'is:closed -reason:"not planned"')
      assert.isNull(searched({ state: 'open', status: status([], ['done']) }))
    })

    it.effect('asks the repository who an assignee is and its owner which board is which, and finds none for no one, or no board', () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          [
            'GET',
            `${REPO}/assignees?per_page=100&page=1`,
            {
              json: [
                { id: 5, login: 'you', name: 'You Person' },
                { id: 6, login: 'sam', name: 'Sam Rivera' },
              ],
            },
          ],
          [
            'POST',
            `${API}/graphql`,
            {
              json: {
                data: { repositoryOwner: { projectsV2: { nodes: [null, { id: 'PVT_1', number: 4, title: 'Roadmap', closed: false }] } } },
              },
            },
          ],
          ['GET', /\/search\/issues\?/, { json: { total_count: 1, items: [issue()] } }],
        ])
        const found = yield* host.find(query({ assignee: 'sam rivera', project: 'roadmap' }))
        assert.deepStrictEqual(
          found.issues.map((one) => one.ref),
          ['meridian/api#12'],
        )
        assert.deepStrictEqual(variablesOf(sent[1]), { owner: 'meridian' })
        assert.strictEqual(
          new URL(sent.at(-1)?.url ?? '').searchParams.get('q'),
          'is:issue repo:meridian/api assignee:sam project:meridian/4',
        )
        const asked = sent.length
        assert.deepStrictEqual(yield* host.find(query({ assignee: 'Alex' })), { issues: [], next: null })
        assert.deepStrictEqual(yield* host.find(query({ project: 'Backlog' })), { issues: [], next: null })
        assert.isFalse(sent.slice(asked).some((request) => request.url.includes('/search/')))
        // Without a repository, an assignee is a login, and no one is asked who it is.
        yield* host.find({ state: 'open', mine: true, assignee: '@sam', limit: 5 })
        assert.strictEqual(new URL(sent.at(-1)?.url ?? '').searchParams.get('q'), 'is:issue is:open assignee:@me assignee:sam')
      }),
    )

    it.effect('finds none, without asking, for a status GitHub hasn’t; and refuses what it can’t find by, before asking', () =>
      Effect.gen(function* () {
        const { host, sent } = github([])
        assert.deepStrictEqual(yield* host.find(query({ status: status(['In Review']) })), { issues: [], next: null })
        assert.deepStrictEqual(yield* host.find(query({ state: 'open', status: status([], ['cancelled']) })), { issues: [], next: null })
        for (const refused of [
          query({ priority: ['high'] }),
          query({ cycle: 'current' }),
          { state: 'all', limit: 5, project: 'Roadmap' } satisfies IssueQuery,
          { state: 'all', limit: 5, parent: '#3' } satisfies IssueQuery,
          query({ parent: 'MER-3' }),
          { state: 'all', limit: 5, keys: ['#3'] } satisfies IssueQuery,
          query({ keys: ['MER-3'] }),
        ]) {
          const failed = yield* Effect.flip(host.find(refused))
          assert.strictEqual(failed.reason, 'rejected')
        }
        assert.lengthOf(sent, 0)
      }),
    )

    it.effect('reads on page after page, as far as GitHub’s search reaches: its first thousand', () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          [
            'GET',
            /\/search\/issues\?/,
            (request) => ({
              json: { total_count: new URL(request.url).searchParams.get('page') === '11' ? 5000 : 250, items: [issue()] },
            }),
          ],
        ])
        const first = yield* host.find(query({ limit: 100 }))
        assert.strictEqual(first.next, '2')
        assert.isNull(new URL(sent.at(-1)?.url ?? '').searchParams.get('page'))
        const second = yield* host.find(query({ limit: 100, cursor: '2' }))
        assert.strictEqual(new URL(sent.at(-1)?.url ?? '').searchParams.get('page'), '2')
        assert.strictEqual(second.next, '3')
        assert.isNull((yield* host.find(query({ limit: 100, cursor: '3' }))).next)
        assert.isNull((yield* host.find(query({ limit: 100, cursor: '10' }))).next)
        assert.strictEqual((yield* host.find(query({ limit: 50, cursor: '11' }))).next, '12')
      }),
    )

    it.effect('reads issues by number one by one, leaving out those it hasn’t and pull requests, narrowed as asked, and pages them', () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          ['GET', `${REPO}/issues/12`, { json: issue({ updated_at: '2026-10-02T08:00:00Z' }) }],
          ['GET', `${REPO}/issues/13`, { json: issue({ number: 13, labels: ['docs'] }) }],
          ['GET', `${REPO}/issues/14`, { json: issue({ number: 14, pull_request: {} }) }],
          [
            'GET',
            `${API}/repos/meridian/web/issues/3`,
            { json: issue({ number: 3, html_url: 'https://github.com/meridian/web/issues/3' }) },
          ],
          ['GET', `${REPO}/issues/15`, { status: 404, json: { message: 'Not Found' } }],
        ])
        const keys = ['#12', '#13', '#14', 'meridian/web#3', '#15', 'meridian/api#12']
        const found = yield* host.find(query({ keys, labels: ['BUG'], limit: 1 }))
        assert.deepStrictEqual(
          found.issues.map((one) => one.ref),
          ['meridian/api#12'],
        )
        assert.strictEqual(found.next, '1')
        // Each read once.
        assert.lengthOf(sent, 5)
        assert.isFalse(sent.some((request) => request.url.includes('/search/')))
        const rest = yield* host.find(query({ keys, labels: ['BUG'], limit: 1, cursor: '1' }))
        assert.deepStrictEqual(
          rest.issues.map((one) => one.ref),
          ['meridian/web#3'],
        )
        assert.isNull(rest.next)
        // Closed asked for, the open ones are left out.
        assert.lengthOf((yield* host.find(query({ keys, state: 'closed' }))).issues, 0)
      }),
    )

    it.effect('narrows issues by number to a board and a parent by the board’s items and the parent’s sub-issues', () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          ['GET', `${REPO}/issues/12`, { json: issue() }],
          ['GET', `${REPO}/issues/13`, { json: issue({ number: 13, html_url: 'https://github.com/meridian/api/issues/13' }) }],
          ['GET', `${REPO}/issues/14`, { json: issue({ number: 14, html_url: 'https://github.com/meridian/api/issues/14' }) }],
          [
            'GET',
            `${REPO}/issues/7/sub_issues?per_page=100&page=1`,
            {
              json: [
                issue({ number: 12, repository_url: `${REPO}` }),
                issue({ number: 13, repository_url: `${REPO}` }),
                issue({ number: 99, repository_url: `${REPO}` }),
              ],
            },
          ],
          [
            'POST',
            `${API}/graphql`,
            (request) => {
              const body = request.body as { query: string; variables: { number?: number } }
              if (body.query.includes('projectsV2'))
                return {
                  json: {
                    data: {
                      repositoryOwner: {
                        projectsV2: { nodes: [{ id: 'PVT_roadmap', number: 4, title: 'Roadmap', closed: false }, null] },
                      },
                    },
                  },
                }
              const boards = body.variables.number === 12 ? ['PVT_roadmap'] : ['PVT_other']
              return {
                json: {
                  data: { repository: { issue: { projectItems: { nodes: boards.map((id) => ({ id: `PVTI_${id}`, project: { id } })) } } } },
                },
              }
            },
          ],
        ])
        const refs = (page: IssuePage) => page.issues.map((one) => one.ref)
        const keys = ['#12', '#13', '#14']
        // Under #7: those of its sub-issues asked for.
        assert.deepStrictEqual(refs(yield* host.find(query({ keys, parent: '#7' }))), ['meridian/api#12', 'meridian/api#13'])
        // On the board: those whose items are on it.
        assert.deepStrictEqual(refs(yield* host.find(query({ keys, project: 'roadmap' }))), ['meridian/api#12'])
        // Both: those under #7 on the board, the board asked of only those.
        const before = sent.length
        assert.deepStrictEqual(refs(yield* host.find(query({ keys: ['#13', '#14'], parent: '#7', project: 'Roadmap' }))), [])
        assert.lengthOf(
          sent.slice(before).filter((request) => JSON.stringify(request.body ?? '').includes('projectItems')),
          1,
        )
        // A board of no such name: none.
        assert.deepStrictEqual(refs(yield* host.find(query({ keys, project: 'Nowhere' }))), [])
        assert.isFalse(sent.some((request) => request.url.includes('/search/')))
      }),
    )
  })

  it.effect('reads an issue’s latest comments, oldest first, from only the pages that hold them', () =>
    Effect.gen(function* () {
      const comment = (n: number) => ({
        id: n,
        user: n === 250 ? null : { id: 5, login: 'you' },
        body: `Comment ${n}`,
        created_at: `2026-10-01T08:00:00Z`,
      })
      const page = (number: number, count: number) => Array.from({ length: count }, (_, at) => comment((number - 1) * 100 + at + 1))
      const { host, sent } = github([
        ['GET', `${REPO}/issues/12`, { json: issue({ comments: 250 }) }],
        ['GET', `${REPO}/issues/12/comments?per_page=100&page=2`, { json: page(2, 100) }],
        ['GET', `${REPO}/issues/12/comments?per_page=100&page=3`, { json: page(3, 50) }],
        ['GET', `${REPO}/issues/13`, { json: issue({ number: 13, comments: 0 }) }],
      ])
      const discussed = yield* host.issue('meridian/api#12')
      const commentPages = () => sent.filter((request) => request.url.includes('/comments')).map((request) => request.url.slice(-6))
      // A hundred at most: the latest hundred of 250 are on pages 2 and 3.
      const latest = yield* host.comments(discussed, 120)
      assert.lengthOf(latest, 100)
      assert.deepStrictEqual([latest[0]?.body, latest.at(-1)?.body], ['Comment 151', 'Comment 250'])
      assert.deepStrictEqual(latest[0], {
        author: { id: '5', login: 'you', name: null, bot: false },
        body: 'Comment 151',
        at: '2026-10-01T08:00:00Z',
      })
      assert.isNull(latest.at(-1)?.author)
      assert.deepStrictEqual(commentPages(), ['page=2', 'page=3'])
      const few = yield* host.comments(discussed, 3)
      assert.deepStrictEqual(
        few.map((one) => one.body),
        ['Comment 248', 'Comment 249', 'Comment 250'],
      )
      assert.deepStrictEqual(commentPages(), ['page=2', 'page=3', 'page=3'])
      // None at all: no page is asked for.
      assert.deepStrictEqual(yield* host.comments({ ...discussed, ref: 'meridian/api#13' }, 10), [])
      assert.lengthOf(commentPages(), 3)
    }),
  )

  it.effect('lists the account’s open issues, in a repository or everywhere, without pull requests', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', `${API}/user`, { json: { id: 5, login: 'you' } }],
        ['GET', /\/repos\/meridian\/api\/issues\?assignee=you&state=open/, { json: [issue(), issue({ number: 15, pull_request: {} })] }],
        ['GET', /\/issues\?filter=assigned&state=open/, { json: [issue({ repository_url: 'https://api.github.com/repos/meridian/web' })] }],
      ])
      const here = yield* host.mine({ container: 'meridian/api', limit: 10 })
      assert.deepStrictEqual(
        here.map((found) => found.ref),
        ['meridian/api#12'],
      )
      assert.include(sent[1]?.url, 'per_page=10')
      const everywhere = yield* host.mine()
      assert.strictEqual(everywhere[0]?.ref, 'meridian/web#12')
    }),
  )

  it.effect('comments on an issue, and has no links to attach', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['POST', `${REPO}/issues/12/comments`, { status: 201, json: {} }]])
      const found: Issue = {
        id: '900',
        ref: 'meridian/api#12',
        key: '#12',
        title: 't',
        body: '',
        url: 'https://github.com/meridian/api/issues/12',
        status: { name: 'Open', category: 'todo' },
        priority: null,
        assignees: [],
        labels: [],
        container: 'meridian/api',
        updatedAt: '2026-10-01T08:00:00Z',
      }
      yield* host.comment(found, 'Picked up by Althar')
      assert.deepStrictEqual(sent[0]?.body, { body: 'Picked up by Althar' })
      yield* host.link(found, { url: 'https://x', title: 'x' })
      // An issue has no In Progress of its own: it is left open, as it is.
      assert.deepStrictEqual(yield* host.start(found), { moved: false, status: { name: 'Open', category: 'todo' } })
      assert.lengthOf(sent, 1)
      assert.isFalse(host.capabilities.links)
      assert.isFalse(host.capabilities.starts)
    }),
  )
  it.effect('lists the repositories it can file issues in, last pushed first, leaving out the archived and those without issues', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'GET',
          `${API}/user/repos?per_page=100&sort=pushed&page=1`,
          {
            json: [
              { id: 7, full_name: 'meridian/api', has_issues: true, archived: false },
              { id: 8, full_name: 'meridian/old', has_issues: true, archived: true },
              { id: 9, full_name: 'meridian/docs', has_issues: false, archived: false },
              { id: 10, full_name: 'you/dotfiles' },
            ],
          },
        ],
      ])
      assert.deepStrictEqual(yield* host.containers(), [
        { id: 'meridian/api', key: 'meridian/api', name: 'meridian/api' },
        { id: 'you/dotfiles', key: 'you/dotfiles', name: 'you/dotfiles' },
      ])
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('follows the repositories page after page until a page comes short, and stops at ten', () =>
    Effect.gen(function* () {
      const repositories = (page: number, count: number) =>
        Array.from({ length: count }, (_, at) => ({ id: page * 100 + at, full_name: `meridian/repo-${page}-${at}` }))
      const listed = `${API}/user/repos?per_page=100&sort=pushed&page=`
      const { host, sent } = github([
        ['GET', `${listed}1`, { json: repositories(1, 100) }],
        ['GET', `${listed}2`, { json: repositories(2, 3) }],
      ])
      const found = yield* host.containers()
      assert.lengthOf(found, 103)
      assert.strictEqual(found.at(-1)?.id, 'meridian/repo-2-2')
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [`${listed}1`, `${listed}2`],
      )
      // Every page full: ten are read, and no more.
      const endless = github([['GET', /\/user\/repos\?per_page=100&sort=pushed&page=\d+$/, { json: repositories(0, 100) }]])
      assert.lengthOf(yield* endless.host.containers(), 1000)
      assert.lengthOf(endless.sent, 10)
    }),
  )

  it.effect('files an issue in a repository, with its labels as they are, or none', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['POST', `${REPO}/issues`, { status: 201, json: issue({ assignees: [], labels: [{ name: 'payments' }] }) }],
      ])
      const filed = yield* host.create('meridian/api', {
        title: 'Refunds ignore the rate limit',
        body: 'They should not.',
        labels: ['payments'],
      })
      assert.deepStrictEqual([filed.ref, filed.labels, filed.container], ['meridian/api#12', ['payments'], 'meridian/api'])
      assert.deepStrictEqual(sent[0]?.body, { title: 'Refunds ignore the rate limit', body: 'They should not.', labels: ['payments'] })
      yield* host.create('meridian/api', { title: 'Refunds ignore the rate limit', body: '', labels: [] })
      assert.deepStrictEqual(sent[1]?.body, { title: 'Refunds ignore the rate limit', body: '' })
    }),
  )

  it.effect('files an issue with its people, its milestone and its type at once', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['POST', `${REPO}/issues`, { status: 201, json: issue({ milestone: { number: 3, title: 'Q4 launch' }, type: { name: 'Bug' } }) }],
      ])
      const filed = yield* host.create('meridian/api', {
        title: 'Refunds ignore the rate limit',
        body: 'They should not.',
        labels: ['payments'],
        fields: {
          assignee: {
            add: [
              { id: 'you', name: 'You' },
              { id: 'sam', name: 'sam' },
            ],
            remove: [],
          },
          milestone: { id: '3', name: 'Q4 launch' },
          type: { id: 'Bug', name: 'Bug' },
        },
      })
      assert.deepStrictEqual(sent[0]?.body, {
        title: 'Refunds ignore the rate limit',
        body: 'They should not.',
        labels: ['payments'],
        assignees: ['you', 'sam'],
        milestone: 3,
        type: 'Bug',
      })
      assert.deepStrictEqual([filed.milestone, filed.type], [{ id: '3', name: 'Q4 launch' }, 'Bug'])
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('says what it was given isn’t a repository, without asking', () =>
    Effect.gen(function* () {
      const { host, sent } = github([])
      for (const container of ['meridian', 'meridian/api/web', 'meridian/api#12', 'MER'])
        assert.deepStrictEqual(
          (yield* Effect.flip(host.create(container, { title: 't', body: '', labels: [] }))).message,
          `Not a GitHub repository: ${container}`,
        )
      assert.lengthOf(sent, 0)
    }),
  )
})

it.effect('reads check annotations and run artifacts, and downloads an archive without forwarding credentials', () =>
  Effect.gen(function* () {
    const { host, sent } = github([
      ['GET', `${REPO}/check-runs/7/annotations?per_page=100`, { json: [{ path: 'a.ts', start_line: 3, message: 'uncovered' }] }],
      ['GET', `${REPO}/actions/jobs/7`, { json: { run_id: 9 } }],
      [
        'GET',
        `${REPO}/actions/runs/9/artifacts?per_page=100`,
        { json: { artifacts: [{ id: 11, name: 'coverage', size_in_bytes: 2, expired: false }] } },
      ],
      ['GET', `${REPO}/actions/artifacts/11/zip`, { status: 302, headers: { location: 'https://storage.example/archive' } }],
      ['GET', 'https://storage.example/archive', { text: 'PK' }],
    ])
    const check = { id: 'run:7:github-actions', name: 'test', state: 'passed' as const, url: null, summary: null }
    assert.deepEqual(yield* host.checkAnnotations!(repository, check), [{ path: 'a.ts', line: 3, message: 'uncovered' }])
    assert.deepEqual(yield* host.checkArtifacts!(repository, check), [{ id: '11', name: 'coverage', size: 2 }])
    assert.deepEqual([...(yield* host.checkArtifact!(repository, '11', 5))], [80, 75])
    assert.isUndefined(sent.at(-1)?.headers.authorization)
  }),
)

it.effect('lists a job with its workflow and timing when GitHub reports them', () =>
  Effect.gen(function* () {
    const { host } = github([
      [
        'GET',
        `${REPO}/commits/main/check-runs?per_page=100`,
        {
          json: {
            check_runs: [
              {
                id: 7,
                name: 'verify',
                status: 'completed',
                conclusion: 'success',
                started_at: '2026-10-31T10:00:00Z',
                completed_at: '2026-10-31T10:01:00Z',
                check_suite: { id: 4 },
                app: { slug: 'github-actions' },
              },
            ],
          },
        },
      ],
      ['GET', `${REPO}/commits/main/status?per_page=100`, { json: { statuses: [] } }],
      ['GET', `${REPO}/actions/runs?branch=main&per_page=100`, { json: { workflow_runs: [{ check_suite_id: 4, name: 'harness' }] } }],
    ])
    const [job] = yield* host.checks(repository, 'main')
    assert.deepInclude(job, { name: 'verify', workflow: 'harness', startedAt: '2026-10-31T10:00:00Z', completedAt: '2026-10-31T10:01:00Z' })
  }),
)

describe('GitHub’s pictures', () => {
  const picture = { bytes: Uint8Array.of(137, 80, 78, 71), name: 'empty state.png', mediaType: 'image/png' }
  const UPLOADS = /^https:\/\/uploads\.github\.com\/user-attachments\/assets\?/

  it.effect('uploads one for the repository, by its number, as GitHub’s own CLI attaches one', () =>
    Effect.gen(function* () {
      const asset = 'https://github.com/user-attachments/assets/0c8e1a2b-3f4d-4e5f-9a6b-7c8d9e0f1a2b'
      const { host, sent } = github([['POST', UPLOADS, { status: 201, json: { url: asset } }]])
      assert.isTrue(host.capabilities.pictures)
      assert.strictEqual(yield* host.uploadPicture?.(repository, picture) ?? Effect.die('none'), asset)
      const [asked] = sent
      const query = new URL(asked?.url ?? '').searchParams
      assert.deepStrictEqual(Object.fromEntries(query), { name: 'empty state.png', content_type: 'image/png', repository_id: '7' })
      assert.strictEqual(asked?.headers['content-type'], 'application/octet-stream')
      assert.strictEqual(asked?.headers.authorization, 'Bearer ghu_t')
      assert.deepStrictEqual([...(asked?.bytes ?? [])], [137, 80, 78, 71])
    }),
  )

  it.effect('says write access is what it needs, where GitHub answers as if the repository weren’t there', () =>
    Effect.gen(function* () {
      const { host } = github([['POST', UPLOADS, { status: 404, json: { message: 'Not Found' } }]])
      const failed = yield* Effect.flip(host.uploadPicture?.(repository, picture) ?? Effect.die('none'))
      assert.strictEqual(failed.reason, 'forbidden')
      assert.strictEqual(failed.status, 404)
      assert.match(failed.message, /write access/)
    }),
  )

  it.effect('passes on any other refusal as GitHub said it', () =>
    Effect.gen(function* () {
      const { host } = github([['POST', UPLOADS, { status: 422, json: { message: 'File type not allowed' } }]])
      const failed = yield* Effect.flip(host.uploadPicture?.(repository, picture) ?? Effect.die('none'))
      assert.strictEqual(failed.reason, 'rejected')
      assert.strictEqual(failed.message, 'File type not allowed')
    }),
  )

  it.effect('never takes an address off GitHub for one', () =>
    Effect.gen(function* () {
      for (const url of ['https://example.com/a.png', 'http://github.com/user-attachments/assets/1', 'not a url']) {
        const { host } = github([['POST', UPLOADS, { status: 201, json: { url } }]])
        const failed = yield* Effect.flip(host.uploadPicture?.(repository, picture) ?? Effect.die('none'))
        assert.strictEqual(failed.reason, 'invalid_response', url)
      }
      const served = 'https://private-user-images.githubusercontent.com/1/2.png'
      const { host } = github([['POST', UPLOADS, { status: 201, json: { url: served } }]])
      assert.strictEqual(yield* host.uploadPicture?.(repository, picture) ?? Effect.die('none'), served)
    }),
  )

  it.effect('takes them on a ghe.com tenant, by its own uploads host, and none on Enterprise Server', () =>
    Effect.gen(function* () {
      const tenant = stubFetch([
        ['POST', /^https:\/\/uploads\.acme\.ghe\.com\//, { json: { url: 'https://acme.ghe.com/user-attachments/assets/1' } }],
      ])
      const onTenant = makeGitHub({
        fetch: tenant.fetch,
        apiUrl: 'https://api.acme.ghe.com',
        webUrl: 'https://acme.ghe.com',
        credential: Effect.succeed({ kind: 'bearer', token: 't' }),
      })
      assert.strictEqual(
        yield* onTenant.uploadPicture?.(repository, picture) ?? Effect.die('none'),
        'https://acme.ghe.com/user-attachments/assets/1',
      )
      const server = github([], 'https://git.example.com/api/v3')
      assert.isFalse(server.host.capabilities.pictures)
      const refused = yield* Effect.flip(server.host.uploadPicture?.(repository, picture) ?? Effect.die('none'))
      assert.strictEqual(refused.reason, 'rejected')
      assert.isEmpty(server.sent)
    }),
  )

  it.effect('writes a comment in the conversation anew', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'PATCH',
          `${REPO}/issues/comments/91`,
          {
            json: {
              id: 91,
              user: { id: 5, login: 'you', type: 'User' },
              author_association: 'OWNER',
              body: 'Again',
              updated_at: '2026-10-31T12:00:00Z',
              html_url: 'https://github.com/meridian/api/pull/12#issuecomment-91',
            },
          },
        ],
      ])
      const edited = yield* host.editComment?.(repository, 12, '91', 'Again') ?? Effect.die('none')
      assert.deepStrictEqual(sent[0]?.body, { body: 'Again' })
      assert.strictEqual(edited.id, '91')
      assert.strictEqual(edited.body, 'Again')
      assert.isNull(edited.threadId)
      assert.strictEqual(edited.url, 'https://github.com/meridian/api/pull/12#issuecomment-91')
    }),
  )
})

describe('GitHub opening a closed pull request again', () => {
  it.effect('opens a closed one, leaves an open one as it is, and says a merged one can’t be', () =>
    Effect.gen(function* () {
      assert.isTrue(github([]).host.capabilities.reopen)
      const { host, sent } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed' }) }],
        ['PATCH', `${REPO}/pulls/12`, { json: pull({ state: 'open' }) }],
      ])
      const closed = yield* host.change(repository, 12)
      assert.strictEqual((yield* host.reopenChange(repository, closed)).state, 'open')
      assert.deepStrictEqual(sent.find((request) => request.method === 'PATCH')?.body, { state: 'open' })
      const open = github([['GET', `${REPO}/pulls/12`, { json: pull() }]])
      assert.strictEqual((yield* open.host.reopenChange(repository, closed)).state, 'open')
      assert.isFalse(open.sent.some((request) => request.method === 'PATCH'))
      const merged = github([['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-02T00:00:00Z' }) }]])
      assert.deepInclude(yield* Effect.flip(merged.host.reopenChange(repository, closed)), { reason: 'rejected' })
      assert.isFalse(merged.sent.some((request) => request.method === 'PATCH'))
      const refusing = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed' }) }],
        ['PATCH', `${REPO}/pulls/12`, { status: 403, json: { message: 'Resource not accessible by integration' } }],
      ])
      assert.deepInclude(yield* Effect.flip(refusing.host.reopenChange(repository, closed)), { reason: 'forbidden', status: 403 })
    }),
  )
})

describe('GitHub’s open pull requests, for following them', () => {
  const LIST = `${REPO}/pulls?state=open&sort=updated&direction=desc&per_page=100`
  const quiet = (request: Sent) =>
    request.headers['if-none-match'] === '"v1"'
      ? { status: 304, headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' } }
      : {
          json: [
            pull({
              draft: false,
              head: { ref: 'fix', sha: 'abc', repo: { full_name: 'stranger/api' } },
              base: { ref: 'main', repo: { full_name: 'meridian/api' } },
            }),
          ],
          headers: { etag: '"v1"', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4991', 'x-ratelimit-reset': '1790000000' },
        }

  it.effect('lists them by ETag, with the fork each comes from, and a 304 is not counted', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['GET', LIST, quiet]])
      const first = yield* host.openChanges!(repository)
      assert.deepStrictEqual(
        first.map((one) => [one.number, one.headSha, one.forkOwner, one.checks]),
        [[12, 'abc', 'stranger', null]],
      )
      assert.strictEqual(host.allowance!().counted, 1)
      assert.deepStrictEqual([host.allowance!().limit, host.allowance!().remaining], [5000, 4991])
      // Asked again, GitHub answers 304 for nothing: the list is the same, and nothing is counted.
      assert.strictEqual((yield* host.openChanges!(repository)).length, 1)
      assert.strictEqual(sent[1]?.headers['if-none-match'], '"v1"')
      assert.strictEqual(host.allowance!().counted, 1)
      assert.strictEqual(host.allowance!().remaining, 4990)
    }),
  )
})

describe('GitHub bringing a pull request’s branch up to date', () => {
  const COMPARE = `${REPO}/compare/main...abc`
  const UPDATE = `${REPO}/pulls/12/update-branch`
  const change = {
    id: 'PR_1',
    number: 12,
    title: '',
    body: '',
    url: '',
    state: 'open' as const,
    draft: false,
    source: 'althar/mer-231',
    target: 'main',
    headSha: 'abc',
    author: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    updatedAt: '',
  }
  const hosted = (routes: ReadonlyArray<Route>, merge?: Parameters<typeof makeGitHub>[0]['merge']) => {
    const { fetch, sent } = stubFetch(routes)
    return {
      host: makeGitHub({
        fetch,
        apiUrl: API,
        webUrl: 'https://github.com',
        credential: Effect.succeed({ kind: 'bearer', token: 'ghu_t' }),
        ...(merge === undefined ? {} : { merge }),
      }),
      sent,
    }
  }

  it.effect('asks GitHub to merge the base in, at the head it read, never to rebase', () =>
    Effect.gen(function* () {
      const { host, sent } = hosted([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['GET', COMPARE, { json: { behind_by: 3 } }],
        ['PUT', UPDATE, { status: 202, json: { message: 'Updating pull request branch.' } }],
      ])
      // GitHub merges in the background: the branch hasn't moved when it answers.
      assert.deepStrictEqual(yield* host.updateBranch(repository, change, { expectedHead: 'abc' }), { outcome: 'updated', head: null })
      assert.deepStrictEqual(sent.find((request) => request.method === 'PUT')?.body, { expected_head_sha: 'abc', update_method: 'merge' })
    }),
  )

  it.effect('says so, and sends nothing, when the branch has everything the base has', () =>
    Effect.gen(function* () {
      const { host, sent } = hosted([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['GET', COMPARE, { json: { behind_by: 0 } }],
      ])
      assert.deepStrictEqual(yield* host.updateBranch(repository, change, { expectedHead: 'abc' }), { outcome: 'current' })
      assert.isFalse(sent.some((request) => request.method === 'PUT'))
    }),
  )

  it.effect('leaves a branch pushed to since it was read, and a pull request that is no longer open', () =>
    Effect.gen(function* () {
      const moved = hosted([['GET', `${REPO}/pulls/12`, { json: pull({ head: { ref: 'althar/mer-231', sha: 'def' } }) }]])
      assert.deepStrictEqual(yield* moved.host.updateBranch(repository, change, { expectedHead: 'abc' }), { outcome: 'moved', head: 'def' })
      assert.isFalse(moved.sent.some((request) => request.method === 'PUT'))
      // GitHub's own check catches a push between its read and ours.
      const raced = hosted([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['GET', COMPARE, { json: { behind_by: 1 } }],
        ['PUT', UPDATE, { status: 422, json: { message: 'expected head sha didn’t match current head ref.' } }],
      ])
      assert.strictEqual((yield* raced.host.updateBranch(repository, change, { expectedHead: 'abc' })).outcome, 'moved')
      const closed = hosted([['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed' }) }]])
      assert.deepInclude(yield* Effect.flip(closed.host.updateBranch(repository, change, { expectedHead: 'abc' })), { reason: 'rejected' })
    }),
  )

  it.effect('stops at a conflict and names the files, read by merging in a copy that pushes nothing', () =>
    Effect.gen(function* () {
      const seen: Array<boolean> = []
      const { host } = hosted(
        [
          ['GET', `${REPO}/pulls/12`, { json: pull() }],
          ['GET', COMPARE, { json: { behind_by: 1 } }],
          ['PUT', UPDATE, { status: 422, json: { message: 'merge conflict between base and head' } }],
        ],
        (merge) => {
          seen.push(merge.push)
          return Effect.succeed({ outcome: 'conflict', files: ['src/refunds.ts'] })
        },
      )
      assert.deepStrictEqual(yield* host.updateBranch(repository, change, { expectedHead: 'abc' }), {
        outcome: 'conflict',
        files: ['src/refunds.ts'],
      })
      assert.deepStrictEqual(seen, [false])
    }),
  )

  it.effect('says no_access for a fork’s branch GitHub won’t let the account push to, and fails for its own in GitHub’s words', () =>
    Effect.gen(function* () {
      const fork = hosted([
        [
          'GET',
          `${REPO}/pulls/12`,
          {
            json: pull({
              head: { ref: 'fix-typo', sha: 'abc', repo: { full_name: 'stranger/api' } },
              base: { ref: 'main', repo: { full_name: 'meridian/api' } },
            }),
          },
        ],
        ['GET', COMPARE, { json: { behind_by: 1 } }],
        [
          'PUT',
          UPDATE,
          { status: 422, json: { message: 'Cannot push to the head branch: the author doesn’t allow edits from maintainers.' } },
        ],
      ])
      const refused = yield* fork.host.updateBranch(repository, change, { expectedHead: 'abc' })
      assert.strictEqual(refused.outcome, 'no_access')
      const own = hosted([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['GET', COMPARE, { json: { behind_by: 1 } }],
        ['PUT', UPDATE, { status: 403, json: { message: 'Resource not accessible by integration' } }],
      ])
      assert.deepInclude(yield* Effect.flip(own.host.updateBranch(repository, change, { expectedHead: 'abc' })), { reason: 'forbidden' })
    }),
  )
})
