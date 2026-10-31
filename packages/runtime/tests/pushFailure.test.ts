import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { GitFailed, PushRefused } from '../src/errors'
import { gitWithin } from '../src/git'
import { pushDetailOf, pushFailureOf } from '../src/pushFailure'
import { words } from '../src/words'

/*
 * A push that fails says why in a sentence with its way out, from what git
 * wrote as the hosts word it, and keeps all git said for Details: never the
 * command line in its place.
 */

const failed = (stderr: string, ended: Partial<Pick<GitFailed, 'reason' | 'code' | 'signal' | 'timedOut' | 'timeout'>> = { code: 128 }) =>
  new GitFailed({ args: ['push', '--', 'origin', `${'8ac5a185'.repeat(5)}:refs/heads/fix-it`], cwd: '/repo', stderr, ...ended })

/** What the person reads for a push that failed so: its reason, its sentence, and the Details under it. */
const pushed = (git: GitFailed) => {
  // As Changes' refusal makes it: one none of the patterns names is `failed`, its sentence safe and all git said under Details.
  const known = pushFailureOf(git) ?? { why: 'failed' as const }
  const error = new PushRefused({ taskId: 'task', remote: 'origin/fix-it', host: 'GitLab', detail: pushDetailOf(git), ...known })
  return { why: known.why, ...words(error, String) }
}

describe('a push that failed', () => {
  it('says a sign-in GitLab refused, and offers connecting it or signing git in', () => {
    const { why, message, detail } = pushed(
      failed(
        "remote: HTTP Basic: Access denied. If a password was provided for Git authentication, the password was incorrect or you're required to use a token.\nfatal: Authentication failed for 'https://gitlab.com/acme/engine.git/'",
      ),
    )
    assert.strictEqual(why, 'denied')
    assert.strictEqual(
      message,
      'GitLab didn’t accept your sign-in, so nothing was pushed. Sign git in to GitLab from a terminal, then try again.',
    )
    assert.include(detail, 'Authentication failed for')
    assert.include(detail, 'Exit code 128.')
    // A missing sign-in, which git couldn't ask for, and a key SSH refused, are the same.
    for (const stderr of [
      "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled",
      'git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    ])
      assert.strictEqual(pushed(failed(stderr)).why, 'denied')
  })

  it('says an account without permission, and suggests a fork or asking for access', () => {
    const { why, message } = pushed(
      failed(
        "remote: You are not allowed to push code to this project.\nfatal: unable to access 'https://gitlab.com/acme/engine.git/': The requested URL returned error: 403",
      ),
    )
    assert.strictEqual(why, 'forbidden')
    assert.strictEqual(
      message,
      'Your account can’t push to this repository on GitLab, so nothing was pushed. Push to a fork of it, or ask its owners for access.',
    )
    for (const stderr of ['remote: Permission to acme/engine.git denied to alice.', 'ERROR: permission denied to push to acme/engine'])
      assert.strictEqual(pushed(failed(stderr)).why, 'forbidden')
  })

  it('says a protected branch, and suggests another branch, a fork or asking', () => {
    const { why, message } = pushed(
      failed(
        'remote: GitLab: You are not allowed to push code to protected branches on this project.\nTo gitlab.com:acme/engine.git\n ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs',
      ),
    )
    assert.strictEqual(why, 'protected')
    assert.strictEqual(
      message,
      'The branch is protected on GitLab, so it didn’t take the push. Push to another branch or a fork, or ask its owners to let you push to it.',
    )
    assert.strictEqual(
      pushed(
        failed(
          'remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)',
        ),
      ).why,
      'protected',
    )
  })

  it('says a host it couldn’t reach, to try again', () => {
    const { why, message } = pushed(
      failed("fatal: unable to access 'https://gitlab.com/acme/engine.git/': Could not resolve host: gitlab.com"),
    )
    assert.strictEqual(why, 'unreachable')
    assert.strictEqual(message, 'Althar couldn’t reach GitLab, so nothing was pushed. Check this computer’s connection, then try again.')
    assert.strictEqual(
      pushed(failed('ssh: Could not resolve hostname gitlab.com: nodename nor servname provided, or not known')).why,
      'unreachable',
    )
  })

  it('quotes the server’s one line where a hook or a rule refused it', () => {
    const { why, message } = pushed(
      failed('remote: Commit message must reference an issue.\n ! [remote rejected] fix-it -> fix-it (pre-receive hook declined)'),
    )
    assert.strictEqual(why, 'refused')
    assert.strictEqual(message, 'origin/fix-it refused the push: Commit message must reference an issue.')
  })

  it('says commits the remote has that aren’t here, as before', () => {
    assert.strictEqual(pushed(failed(' ! [rejected]        fix-it -> fix-it (fetch first)')).why, 'behind')
  })

  it('says a push stopped with no answer, as git waiting for a sign-in it can’t ask for, never the command line', () => {
    const { why, message, detail } = pushed(failed('', { timedOut: true, timeout: 60_000, signal: 'SIGTERM' }))
    assert.strictEqual(why, 'unanswered')
    assert.strictEqual(
      message,
      'GitLab didn’t answer in time, so the push was stopped. git may have been waiting for a sign-in it couldn’t ask for here: sign git in to GitLab from a terminal, then try again.',
    )
    assert.strictEqual(detail, 'Stopped after a minute with no answer.')
    assert.notInclude(message, 'git -c')
    assert.notInclude(message, '8ac5a185')
  })

  it('says one it can’t name in a sentence of its own, with all git said and how it ended under Details, never the command line', () => {
    const unknown = 'Althar couldn’t push to GitLab. What git said is under Details.'
    assert.deepInclude(pushed(failed('', { code: 1 })), { why: 'failed', message: unknown, detail: 'Exit code 1.' })
    assert.deepInclude(pushed(failed('', { signal: 'SIGKILL' })), { why: 'failed', message: unknown, detail: 'Stopped by SIGKILL.' })
    // One line of git's own, kept whole under Details rather than in the sentence.
    const certificate =
      "fatal: unable to access 'https://gitlab.example.com/acme/engine.git/': SSL certificate problem: self-signed certificate"
    assert.deepInclude(pushed(failed(certificate)), { why: 'failed', message: unknown, detail: `${certificate}\nExit code 128.` })
    // Several lines, stopped by a signal: the signal is kept too.
    assert.deepInclude(pushed(failed('Enumerating objects: 5, done.\nerror: unexpected disconnect', { signal: 'SIGKILL' })), {
      why: 'failed',
      detail: 'Enumerating objects: 5, done.\nerror: unexpected disconnect\nStopped by SIGKILL.',
    })
    assert.deepInclude(pushed(failed('', { timedOut: true, timeout: 10_000 })), { why: 'unanswered' })
  })

  it('keeps Althar’s own stop reason separate from git’s stderr', () => {
    assert.deepInclude(pushed(failed('', { reason: 'git said more than Althar reads.' })), {
      detail: 'git said more than Althar reads.',
    })
  })
})

describe('a git command that fails', () => {
  const repository = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'althar-push-failure-'))
    execFileSync('git', ['init', '-q', cwd])
    return cwd
  }

  it.live('keeps its exit code, and git’s stderr empty where git said nothing, not Node’s command line', () =>
    Effect.gen(function* () {
      const quiet = yield* Effect.flip(gitWithin(10_000, repository(), '-c', 'alias.quiet=!exit 3', 'quiet'))
      assert.deepInclude(quiet, { stderr: '', code: 3 })
      assert.notProperty(quiet, 'timedOut')
      assert.strictEqual(words(quiet, String).message, 'git quiet failed with code 3, without saying why.')
      // What it said, if only a line, stays whole under Details with how it ended.
      const loud = yield* Effect.flip(gitWithin(10_000, repository(), '-c', 'alias.loud=!echo no way >&2; exit 2', 'loud'))
      assert.deepInclude(words(loud, String), { message: "git loud didn't work: no way.", detail: 'no way\nExit code 2.' })
    }),
  )

  it.live('says it ran out of time where it was stopped for it', () =>
    Effect.gen(function* () {
      const slow = yield* Effect.flip(gitWithin(200, repository(), '-c', 'alias.slow=!sleep 2', 'slow'))
      assert.deepInclude(slow, { stderr: '', timedOut: true, timeout: 200, signal: 'SIGTERM' })
      assert.strictEqual(words(slow, String).message, 'git slow got no answer in a second, so Althar stopped it. Try again.')
    }),
  )
})
