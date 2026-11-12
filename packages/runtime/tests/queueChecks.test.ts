import { ConnectorFailed } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { queueDetailOf } from '../src/checkLogs'

describe('the queue build, not the pull request head', () => {
  it.effect('reads two failed jobs’ logs, its own first, bounded, with each page or why unread, and counts the rest', () =>
    Effect.gen(function* () {
      const host = makeFakeService({
        checksOn: (sha) =>
          sha === 'build'
            ? [
                { name: 'one', state: 'failed', url: 'https://ci.test/1', log: 'failure one' },
                { name: 'two', state: 'failed', url: 'https://ci.test/2', log: `${'earlier\n'.repeat(200)}failure two` },
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
      assert.deepStrictEqual(detail.failing, ['one', 'two', 'three', 'four'])
      // The job trunk passes names the pull request; then one trunk hasn't reported on. One trunk fails too comes last.
      assert.deepStrictEqual(
        detail.jobs?.map((job) => job.name),
        ['two', 'three'],
      )
      assert.lengthOf(detail.logs, 3)
      assert.include(detail.logs[0], 'failure two')
      assert.include(detail.logs[0], 'https://ci.test/2')
      assert.isAtMost((detail.jobs?.[0]?.tail ?? '').split('\n').length, 150)
      assert.include(detail.logs[1], '403')
      assert.include(detail.logs[1], 'No Actions permission')
      assert.include(detail.logs[1], 'https://ci.test/3')
      assert.strictEqual(detail.logs[2], "2 more jobs failed, whose logs aren't given here: read_check_log (queue: true) reads one.")
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
