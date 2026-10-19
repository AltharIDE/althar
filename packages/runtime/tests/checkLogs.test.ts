import { ConnectorFailed } from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'

import { logForLead, whyUnread } from '../src/checkLogs'

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
