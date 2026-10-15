import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { fromOutside } from '../src/model'
import { makeFakeService } from '../src/testing'
import { hostContract, trackerContract } from './contract'

const fake = makeFakeService({ pushUrl: (path) => `/tmp/fake/${path.join('/')}.git` })
fake.addRepository(['meridian', 'api'])
fake.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges' })
let branches = 0

hostContract({
  name: 'The fake',
  host: fake,
  path: ['meridian', 'api'],
  branch: Effect.sync(() => `althar/contract-${(branches += 1)}`),
})
trackerContract({ name: 'The fake', tracker: fake, ref: 'MER-231' })

// Only the fake files issues in the suite: a real service's contract would file real ones.
describe('The fake, filing issues', () => {
  it.effect('lists its repositories and the containers a test adds, and files an issue in one, labels and all', () =>
    Effect.gen(function* () {
      const service = makeFakeService()
      service.addRepository(['meridian', 'api'])
      assert.deepStrictEqual(service.addContainer({ id: 'team-1', key: 'MER', name: 'Meridian' }), {
        id: 'team-1',
        key: 'MER',
        name: 'Meridian',
      })
      service.addContainer({ id: 'list-1', name: 'Roadmap / To do' })
      assert.deepStrictEqual(yield* service.containers(), [
        { id: 'meridian/api', key: 'meridian/api', name: 'meridian/api' },
        { id: 'team-1', key: 'MER', name: 'Meridian' },
        { id: 'list-1', key: null, name: 'Roadmap / To do' },
      ])

      service.addIssue({ ref: 'MER-1', title: 'Already there' })
      const filed = yield* service.create('team-1', { title: 'Rate-limit refunds', body: 'They skip it.', labels: ['payments'] })
      assert.deepStrictEqual(
        [filed.ref, filed.title, filed.body, filed.labels, filed.container, filed.assignees],
        ['MER-2', 'Rate-limit refunds', 'They skip it.', ['payments'], 'Meridian', []],
      )
      assert.deepStrictEqual(yield* service.issue('MER-2'), filed)
      // Filed, not assigned: not among the account's own.
      assert.isFalse((yield* service.mine()).some((issue) => issue.ref === 'MER-2'))

      const inRepository = yield* service.create('meridian/api', { title: 'Checkout gives up', body: '', labels: [] })
      assert.deepStrictEqual([inRepository.ref, inRepository.key, inRepository.container], ['meridian/api#1', '#1', 'meridian/api'])
      const onList = yield* service.create('list-1', { title: 'A card', body: '', labels: [] })
      assert.deepStrictEqual([onList.ref, onList.container], ['list-1#1', 'Roadmap / To do'])
      assert.deepStrictEqual(
        service.created.map((issue) => issue.ref),
        ['MER-2', 'meridian/api#1', 'list-1#1'],
      )
    }),
  )

  it.effect('says a container isn’t there, and fails a filing when a test asks', () =>
    Effect.gen(function* () {
      const service = makeFakeService({ product: 'linear' })
      service.addContainer({ id: 'team-1', key: 'MER', name: 'Meridian' })
      assert.strictEqual((yield* Effect.flip(service.create('team-9', { title: 't', body: '', labels: [] }))).reason, 'not_found')
      service.failNext('create', 'forbidden', undefined, 403)
      const refused = yield* Effect.flip(service.create('team-1', { title: 't', body: '', labels: [] }))
      assert.deepStrictEqual([refused.reason, refused.status], ['forbidden', 403])
      service.failNext('containers', 'unreachable')
      assert.strictEqual((yield* Effect.flip(service.containers())).reason, 'unreachable')
      assert.lengthOf(service.created, 0)
      assert.deepStrictEqual(service.calls, ['create', 'create', 'containers'])
    }),
  )
})

// Someone else's pull request, as Althar reviews one it didn't open (docs/architecture/06).
describe('The fake, reviewing someone else’s pull request', () => {
  it.effect('reads who opened it and from where, posts reviews on an open one only, and refuses on a host without reviews', () =>
    Effect.gen(function* () {
      const service = makeFakeService()
      const repository = service.addRepository(['meridian', 'api'])
      const team = service.addPullRequest({ path: ['meridian', 'api'], title: 'Retry refunds', author: 'ana', baseSha: 'b45e' })
      const fork = service.addPullRequest({
        path: ['meridian', 'api'],
        title: 'Send back',
        author: 'ninemate',
        member: false,
        fork: ['ninemate', 'api'],
        headSha: 'd4c8ae4',
      })
      const gone = service.addPullRequest({ path: ['meridian', 'api'], title: 'Gone', author: 'ana', fork: [], state: 'merged' })
      const inside = yield* service.changeToReview(repository, team.number)
      assert.deepInclude(inside, { member: true, fork: null, baseSha: 'b45e', title: 'Retry refunds' })
      assert.strictEqual(inside.author?.login, 'ana')
      assert.isFalse(fromOutside(inside))
      const outside = yield* service.changeToReview(repository, fork.number)
      assert.deepStrictEqual(
        [outside.member, outside.fork, outside.headSha, outside.baseSha],
        [false, ['ninemate', 'api'], 'd4c8ae4', null],
      )
      assert.isTrue(fromOutside(outside))
      assert.deepStrictEqual((yield* service.changeToReview(repository, gone.number)).fork, [])
      assert.strictEqual((yield* Effect.flip(service.changeToReview(repository, 99))).reason, 'not_found')

      const review = {
        event: 'request_changes',
        body: 'Needs a test.',
        commit: 'd4c8ae4',
        comments: [{ path: 'a.ts', line: 3, body: 'Here.' }],
      } as const
      const posted = yield* service.postReview(repository, fork.number, review)
      assert.match(posted.url ?? '', /\/pull\/2#pullrequestreview-/)
      assert.deepStrictEqual(service.reviewsPosted, [{ number: fork.number, id: posted.id, review }])
      // Merged, or not there, nothing posts.
      assert.strictEqual((yield* Effect.flip(service.postReview(repository, gone.number, review))).reason, 'rejected')
      assert.strictEqual((yield* Effect.flip(service.postReview(repository, 99, review))).reason, 'not_found')
      service.failNext('postReview', 'unreachable')
      assert.strictEqual((yield* Effect.flip(service.postReview(repository, team.number, review))).reason, 'unreachable')
      assert.lengthOf(service.reviewsPosted, 1)

      const gitlab = makeFakeService({ product: 'gitlab' })
      const project = gitlab.addRepository(['meridian', 'api'])
      gitlab.addPullRequest({ path: ['meridian', 'api'], title: 'x', author: 'ana' })
      assert.isFalse(gitlab.capabilities.reviews)
      assert.strictEqual((yield* Effect.flip(gitlab.changeToReview(project, 1))).reason, 'rejected')
      assert.strictEqual((yield* Effect.flip(gitlab.postReview(project, 1, review))).reason, 'rejected')
      assert.throws(() => gitlab.addPullRequest({ path: ['nobody', 'here'], title: 'x', author: 'ana' }))
    }),
  )
})
