import { GitFailed } from '@althar/runtime'
import { Cause, Effect, Logger } from 'effect'
import { describe, expect, it } from 'vitest'

import { logLine } from '../src/runtime/logging'

/*
 * The runtime's log line for a git failure (runtime.log): besides its stack,
 * the command's arguments, where it ran and all git said, as fields, and
 * nothing that signs Althar in.
 */

const logged = (effect: Effect.Effect<void>) => {
  const lines: Array<string> = []
  Effect.runSync(effect.pipe(Effect.provide(Logger.layer([Logger.make((options) => void lines.push(logLine(options)))]))))
  return lines
}

describe('a log line for a git failure', () => {
  it('carries git’s arguments, folder and stderr as fields, and its line after GitFailed:', () => {
    const [line] = logged(
      Effect.logWarning(
        'Could not look at whether a lead’s change meets another task’s',
        Cause.fail(
          new GitFailed({
            args: ['diff', '--name-only', 'main...HEAD'],
            cwd: '/w/orchy/fix-login/orchy',
            stderr: 'fatal: gitfile does not point to a valid repository: /w/orchy/fix-login/orchy/.git',
            code: 128,
          }),
        ),
      ),
    )
    expect(line).toContain('level=WARN')
    expect(line).toContain('GitFailed: git diff: gitfile does not point to a valid repository')
    expect(line).toContain('git_args="diff --name-only main...HEAD"')
    expect(line).toContain('git_cwd="/w/orchy/fix-login/orchy"')
    expect(line).toContain('git_stderr="fatal: gitfile does not point to a valid repository: /w/orchy/fix-login/orchy/.git"')
    expect(line).toContain('git_code="128"')
  })

  it('keeps no token git echoed', () => {
    const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
    const [line] = logged(
      Effect.logWarning(
        'Could not fetch',
        Cause.fail(
          new GitFailed({
            args: ['fetch', `https://bot:${token}@github.com/acme/orchy.git`],
            cwd: '/w',
            stderr: `> Authorization: Basic ${token}\nfatal: unable to access 'https://bot:${token}@github.com/acme/orchy.git/': 403`,
          }),
        ),
      ),
    )
    expect(line).not.toContain(token)
    expect(line).toContain('[redacted]')
  })

  it('adds nothing to a line without a git failure', () => {
    const [line] = logged(Effect.logInfo('Runtime ready'))
    expect(line).toBe('level=INFO message="Runtime ready"')
  })
})
