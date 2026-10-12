import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

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
