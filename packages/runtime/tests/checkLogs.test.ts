import { type Check, type CodeHost, ConnectorFailed } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { logForLead, readLog, whyUnread } from '../src/checkLogs'

const failed = (reason: ConnectorFailed['reason'], more: { message?: string; status?: number; retryAt?: string } = {}) =>
  new ConnectorFailed({ product: 'github', reason, message: more.message ?? '', ...more })

describe('a log that couldn’t be read', () => {
  it('says why in plain words, with the host’s status and its own words where it said more than the status', () => {
    assert.strictEqual(
      whyUnread('GitHub', failed('unauthorized', { status: 401, message: 'Bad credentials' })),
      'GitHub refused (401): Bad credentials. Its connection needs signing in again',
    )
    assert.strictEqual(
      whyUnread('GitHub', failed('forbidden', { status: 403, message: '403' })),
      'GitHub refused (403). Its sign-in may not be allowed to read logs',
    )
    assert.strictEqual(
      whyUnread('GitLab', failed('not_found', { status: 404 })),
      'GitLab no longer has it (404). Logs are kept for a while, then deleted',
    )
    assert.strictEqual(whyUnread('GitHub', failed('rate_limited')), "GitHub's rate limit was reached")
    assert.strictEqual(whyUnread('GitHub', failed('rate_limited', { retryAt: '14:05' })), "GitHub's rate limit was reached, until 14:05")
    assert.strictEqual(whyUnread('GitHub', failed('unreachable', { message: 'ETIMEDOUT' })), "GitHub didn't answer: ETIMEDOUT")
    assert.strictEqual(whyUnread('Azure storage', failed('rejected', { status: 403 })), 'Azure storage refused it (403)')
    assert.strictEqual(
      whyUnread('GitHub', failed('invalid_response', { message: 'Unexpected token <' })),
      "GitHub answered with something Althar couldn't read: Unexpected token <",
    )
  })

  it('tells the lead what there is instead: whether reading it again could help, its page, and what the check said of itself', () => {
    const read = { name: 'build', url: null, log: null, missing: null, report: null, kept: false, passing: false }
    assert.strictEqual(logForLead(read), "Althar couldn't read build's log: its host keeps none.")
    assert.strictEqual(
      logForLead({
        ...read,
        url: 'https://ci.example/1',
        missing: "GitHub didn't answer",
        kept: true,
        passing: true,
        report: 'Lint failed',
      }),
      "Althar couldn't read build's log: GitHub didn't answer. read_check_log may read it in a while. Its page: https://ci.example/1\nWhat it reported of itself:\n```\nLint failed\n```",
    )
    assert.strictEqual(
      logForLead({ ...read, missing: 'GitHub refused (403)', kept: true }),
      "Althar couldn't read build's log: GitHub refused (403). Reading it again with read_check_log would fail the same way: work from what is here, or reproduce the check locally.",
    )
    assert.strictEqual(logForLead({ ...read, log: 'error TS2322' }), "The end of build's log:\n```\nerror TS2322\n```")
  })
})

describe('reading a failed check’s log', () => {
  const check: Check = { id: 'check-1', name: 'build', state: 'failed', url: 'https://ci.example/1', summary: null }

  /** A host whose logs and reports answer as the test says, the fake's for everything else. */
  const hostWith = (
    checkLog: CodeHost['checkLog'],
    more: { readonly product?: 'github' | 'gitlab'; readonly checkReport?: CodeHost['checkReport'] } = {},
  ) => {
    const fake = makeFakeService({ product: more.product ?? 'github' })
    const repository = fake.addRepository(['meridian', 'api'])
    const host: CodeHost = { ...fake, checkLog, ...(more.checkReport === undefined ? {} : { checkReport: more.checkReport }) }
    return { host, repository }
  }

  it.effect('gives its end, or all of it where the whole is asked for', () =>
    Effect.gen(function* () {
      const asked: Array<boolean | undefined> = []
      const { host, repository } = hostWith((_repository, _check, whole) => {
        asked.push(whole)
        return Effect.succeed(whole === true ? 'line 1\nFAIL limit.test.ts' : 'FAIL limit.test.ts')
      })
      assert.deepStrictEqual(yield* readLog(host, repository, check), {
        name: 'build',
        url: 'https://ci.example/1',
        log: 'FAIL limit.test.ts',
        missing: null,
        report: null,
        kept: true,
        passing: false,
      })
      assert.strictEqual((yield* readLog(host, repository, check, true)).log, 'line 1\nFAIL limit.test.ts')
      assert.deepStrictEqual(asked, [false, true])
    }),
  )

  it.effect('says the host keeps none of a check another service ran, with what the check reported of itself instead', () =>
    Effect.gen(function* () {
      const none = hostWith(() => Effect.succeed(null), { product: 'gitlab' })
      assert.deepInclude(yield* readLog(none.host, none.repository, check), {
        log: null,
        missing: 'GitLab keeps no log of it that Althar can read',
        report: null,
        kept: false,
        passing: false,
      })
      const reported = hostWith(() => Effect.succeed(null), { checkReport: () => Effect.succeed('Lint: 3 errors in src/limit.ts') })
      const read = yield* readLog(reported.host, reported.repository, check)
      assert.deepInclude(read, { missing: 'GitHub keeps no log of it that Althar can read', report: 'Lint: 3 errors in src/limit.ts' })
      assert.strictEqual(
        logForLead(read),
        "Althar couldn't read build's log: GitHub keeps no log of it that Althar can read. Its page: https://ci.example/1\nWhat it reported of itself:\n```\nLint: 3 errors in src/limit.ts\n```",
      )
      // A report that can't be read leaves only why there is no log.
      const unreported = hostWith(() => Effect.succeed(null), {
        checkReport: () => Effect.fail(new ConnectorFailed({ product: 'github', reason: 'unreachable', message: 'ETIMEDOUT' })),
      })
      assert.deepInclude(yield* readLog(unreported.host, unreported.repository, check), { report: null, kept: false })
    }),
  )

  it.effect('says why a log the host keeps couldn’t be read, and whether reading it again may go otherwise', () =>
    Effect.gen(function* () {
      const failing = (reason: ConnectorFailed['reason'], status?: number) =>
        hostWith(() =>
          Effect.fail(new ConnectorFailed({ product: 'github', reason, message: '', ...(status === undefined ? {} : { status }) })),
        )
      const busy = failing('rate_limited')
      assert.deepInclude(yield* readLog(busy.host, busy.repository, check), {
        log: null,
        missing: "GitHub's rate limit was reached",
        kept: true,
        passing: true,
      })
      const away = failing('unreachable')
      assert.deepInclude(yield* readLog(away.host, away.repository, check), { missing: "GitHub didn't answer", passing: true })
      const gone = failing('not_found', 404)
      assert.deepInclude(yield* readLog(gone.host, gone.repository, check), {
        missing: 'GitHub no longer has it (404). Logs are kept for a while, then deleted',
        kept: true,
        passing: false,
      })
    }),
  )
})
