import { ConnectorFailed } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { queueDetailOf } from '../src/checkLogs'

describe('the queue build, not the pull request head', () => {
  it.effect('reads every failed job with bounded tails, its page or unreadable reason, against the default branch latest SHA', () =>
    Effect.gen(function* () {
      const host = makeFakeService({
        checksOn: (sha) =>
          sha === 'build'
            ? [
                { name: 'one', state: 'failed', url: 'https://ci.test/1', log: `${'earlier\n'.repeat(200)}failure one` },
                { name: 'two', state: 'failed', url: 'https://ci.test/2', log: 'failure two' },
                {
                  name: 'three',
                  state: 'failed',
                  url: 'https://ci.test/3',
                  log: new ConnectorFailed({ product: 'github', reason: 'forbidden', status: 403, message: 'No Actions permission' }),
                },
                { name: 'four', state: 'failed', url: 'https://ci.test/4', log: 'failure four' },
              ]
            : sha === 'trunk-0'
              ? [
                  { name: 'one', state: 'failed' },
                  { name: 'two', state: 'passed' },
                  { name: 'three', state: 'running' },
                ]
              : undefined,
      })
      const repo = host.addRepository(['team', 'repo'], 'trunk')
      const detail = yield* queueDetailOf(host, repo, 'build')
      assert.lengthOf(detail.logs, 4)
      assert.lengthOf(detail.jobs ?? [], 4)
      assert.include(detail.logs[0], 'failure one')
      assert.isAtMost((detail.jobs?.[0]?.tail ?? '').split('\n').length, 150)
      for (let n = 1; n <= 4; n++) assert.include(detail.logs[n - 1], `https://ci.test/${n}`)
      assert.include(detail.logs[2], '403')
      assert.include(detail.logs[2], 'No Actions permission')
      assert.include(detail.main, 'The same jobs also fail on trunk (trunk-0): one. Their failure causes may differ.')
      assert.include(detail.main, 'two passes on trunk')
      assert.include(detail.main, "hasn't reported on three, four yet")
    }),
  )

  it.effect('reports exact lookup failures, never turning an unreadable default branch into no checks', () =>
    Effect.gen(function* () {
      const host = makeFakeService({ checksOn: () => [{ name: 'test', state: 'failed', log: 'boom' }] })
      const repo = host.addRepository(['team', 'repo'])
      host.failNext('checks', 'forbidden', undefined, 403)
      const unread = yield* queueDetailOf(host, repo, 'build')
      assert.include(unread.logs.join('\n'), '403')
      assert.include(unread.logs.join('\n'), "Couldn't read the queue build's checks")
      host.failNext('branchHead', 'unreachable')
      const main = yield* queueDetailOf(host, repo, 'build')
      assert.include(main.main, "Couldn't compare with main's latest commit")
      assert.notInclude(main.main, 'No checks')
      const missing = yield* queueDetailOf(host, repo, null, 'Build lookup denied: Actions permission')
      assert.include(missing.logs.join('\n'), 'Build lookup denied: Actions permission')
    }),
  )
})
