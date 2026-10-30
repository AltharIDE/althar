import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import { guard, guardEnv, guardStopIn, passGuard } from '../src/pushGuard'
import { gitCommandsOf } from '../src/rules'

/*
 * A lead's git stops what can't be undone from its task (ADR-071), wherever
 * it comes from: a plain command, a loop, a script. Real git, in a
 * repository with a remote of its own on this computer.
 */

const at = guard(realpathSync(mkdtempSync(join(tmpdir(), 'althar-guard-test-'))))

/** A repository on the task's branch, pushed, with the default branch and another branch on its remote. */
const repository = () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-guarded-')))
  const remote = join(home, 'remote.git')
  const work = join(home, 'work')
  const plain = (cwd: string, ...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Try', '-c', 'user.email=try@althar.test', ...args], { cwd, encoding: 'utf8' })
  plain(home, 'init', '-q', '--bare', '-b', 'main', remote)
  plain(home, 'init', '-q', '-b', 'main', work)
  writeFileSync(join(work, 'README.md'), '# Meridian\n')
  plain(work, 'add', '.')
  plain(work, 'commit', '-q', '-m', 'Start')
  plain(work, 'remote', 'add', 'origin', remote)
  plain(work, 'push', '-q', 'origin', 'main')
  plain(work, 'branch', 'feature/other')
  plain(work, 'push', '-q', 'origin', 'feature/other')
  plain(work, 'switch', '-qc', 'althar/retry')
  plain(work, 'commit', '-q', '--allow-empty', '-m', 'Retry')
  plain(work, 'push', '-q', 'origin', 'althar/retry')
  return { home, work }
}

const sessionId = 'sess_guarded'
const env = {
  ...process.env,
  ...guardEnv({ sessionId, taskBranch: 'althar/retry', defaultBranches: ['main'], count: 0, at }),
  GIT_AUTHOR_NAME: 'Try',
  GIT_AUTHOR_EMAIL: 'try@althar.test',
  GIT_COMMITTER_NAME: 'Try',
  GIT_COMMITTER_EMAIL: 'try@althar.test',
}

/** A command as a lead's shell runs it, with the guard in its environment: how it ended and what it said. */
const run = (cwd: string, program: string, ...args: Array<string>) => {
  const done = spawnSync(program, args, { cwd, env, encoding: 'utf8' })
  return { status: done.status, said: `${done.stdout}${done.stderr}` }
}

describe("a lead's git", () => {
  it('pushes the task’s branch, and commits with the repository’s own hooks, as before', () => {
    const { work } = repository()
    mkdirSync(join(work, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(work, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho own pre-commit ran\n')
    chmodSync(join(work, '.git', 'hooks', 'pre-commit'), 0o755)
    const committed = run(work, 'git', 'commit', '--allow-empty', '-m', 'More')
    assert.strictEqual(committed.status, 0)
    assert.include(committed.said, 'own pre-commit ran')
    assert.strictEqual(run(work, 'git', 'push', '-q', 'origin', 'althar/retry').status, 0)
    // Tags go as before.
    assert.strictEqual(run(work, 'git', 'tag', 'v1').status, 0)
    assert.strictEqual(run(work, 'git', 'push', '-q', 'origin', 'v1').status, 0)
  })

  it('stops a push to the default branch, a force push and deleting a branch that isn’t the task’s, saying how to ask', () => {
    const { work } = repository()
    for (const [what, args] of [
      ['a push to main', ['push', 'origin', 'althar/retry:main']],
      ['deleting feature/other', ['push', 'origin', '--delete', 'feature/other']],
    ] as const) {
      const stopped = run(work, 'git', ...args)
      assert.notStrictEqual(stopped.status, 0, what)
      assert.include(stopped.said, 'Althar stopped this:', what)
      assert.include(stopped.said, 'outside your sandbox: Althar asks the person', what)
    }
    run(work, 'git', 'commit', '-q', '--amend', '--allow-empty', '-m', 'Retry, again')
    const forced = run(work, 'git', 'push', '--force', 'origin', 'althar/retry')
    assert.notStrictEqual(forced.status, 0)
    assert.include(forced.said, "a force push to althar/retry can't be undone")
    // Here too: deleting another branch, or moving it so it loses commits.
    const deleted = run(work, 'git', 'branch', '-D', 'feature/other')
    assert.notStrictEqual(deleted.status, 0)
    assert.include(deleted.said, "deleting the branch feature/other can't be undone")
    assert.include(run(work, 'git', 'branch', '--list', 'feature/other').said, 'feature/other')
  })

  it('stops them from a script, a loop or $(…) as from a plain command', () => {
    const { work } = repository()
    const script = run(
      work,
      'python3',
      '-c',
      "import subprocess, sys; sys.exit(subprocess.run(['git', 'push', 'origin', 'althar/retry:main']).returncode)",
    )
    assert.notStrictEqual(script.status, 0)
    assert.include(script.said, 'a push to main, the default branch')
    const loop = run(work, 'sh', '-c', 'for b in main; do git push origin "althar/retry:$b" || exit 1; done')
    assert.notStrictEqual(loop.status, 0)
    assert.include(loop.said, 'Althar stopped this:')
  })

  it('names the kind it stopped on a line of its own, for the record to count', () => {
    const { work } = repository()
    assert.strictEqual(guardStopIn(run(work, 'git', 'push', 'origin', 'althar/retry:main').said), 'default-branch')
    assert.strictEqual(guardStopIn(run(work, 'git', 'push', 'origin', '--delete', 'feature/other').said), 'delete-branch')
    assert.strictEqual(guardStopIn(run(work, 'git', 'branch', '-D', 'feature/other').said), 'delete-branch')
    assert.strictEqual(guardStopIn(run(work, 'git', 'push', 'origin', 'althar/retry').said), undefined)
  })

  it('lets through the one git the person allowed, once, and nothing else on its pass', () => {
    const { work } = repository()
    const allowed = 'git push -q origin althar/retry:main'
    passGuard(sessionId, gitCommandsOf(`${allowed} 2>&1`), at)
    // Another irreversible git, in a script or plainly, gets nothing from it.
    const other = run(
      work,
      'python3',
      '-c',
      "import subprocess, sys; sys.exit(subprocess.run(['git', 'push', 'origin', '--delete', 'feature/other']).returncode)",
    )
    assert.notStrictEqual(other.status, 0)
    assert.include(other.said, 'deleting feature/other on origin')
    assert.notStrictEqual(run(work, 'git', 'branch', '-D', 'feature/other').status, 0)
    // What was allowed goes, once.
    assert.strictEqual(run(work, 'git', ...allowed.split(' ').slice(1)).status, 0, 'the allowed push')
    run(work, 'git', 'commit', '-q', '--allow-empty', '-m', 'Again')
    const again = run(work, 'git', ...allowed.split(' ').slice(1))
    assert.notStrictEqual(again.status, 0, 'its pass was spent on the first')
    assert.include(again.said, 'a push to main, the default branch')
  })
})

describe('the git commands a pass names', () => {
  it('are git’s own words: unquoted, without the shell’s redirects or assignments', () => {
    assert.deepStrictEqual(gitCommandsOf(`git push --force origin 'althar/retry' 2>&1 | tail -3`), ['git push --force origin althar/retry'])
    assert.deepStrictEqual(gitCommandsOf('GIT_TRACE=1 /usr/bin/git  push origin HEAD:main && echo done'), ['git push origin HEAD:main'])
    assert.deepStrictEqual(gitCommandsOf('ls'), [])
  })
})
