import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import { guard, guardEnv, guardHolds, guardStopIn, passGuard } from '../src/pushGuard'
import { gitRunsOf } from '../src/rules'

/*
 * A lead's git stops what can't be undone from its task (ADR-071), wherever
 * it comes from: a plain command, a loop, a script. Real git, in a
 * repository with a remote of its own on this computer.
 */

const at = guard(realpathSync(mkdtempSync(join(tmpdir(), 'althar-guard-test-'))))

/**
 * A repository on the task's branch, pushed, with the default branch and another branch on its remote, and a branch of
 * work that is nowhere else (`feature/unmerged`).
 */
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
  plain(work, 'switch', '-qc', 'feature/unmerged')
  plain(work, 'commit', '-q', '--allow-empty', '-m', 'Only here')
  plain(work, 'switch', '-q', 'main')
  plain(work, 'switch', '-qc', 'althar/retry')
  plain(work, 'commit', '-q', '--allow-empty', '-m', 'Retry')
  plain(work, 'push', '-q', 'origin', 'althar/retry')
  return { home, work }
}

const sessionId = 'sess_guarded'

/** The git a line runs, read from a worktree, as the person's allowing it hands it to the pass. */
const runsOf = (line: string, worktree: string) => gitRunsOf(line, { worktree, defaultBranch: 'main', taskBranch: 'althar/retry' })
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
    const deleted = run(work, 'git', 'branch', '-D', 'feature/unmerged')
    assert.notStrictEqual(deleted.status, 0)
    assert.include(deleted.said, "deleting the branch feature/unmerged can't be undone")
    assert.include(run(work, 'git', 'branch', '--list', 'feature/unmerged').said, 'feature/unmerged')
    const moved = run(work, 'git', 'branch', '-f', 'feature/unmerged', 'main')
    assert.notStrictEqual(moved.status, 0)
    assert.include(moved.said, "moving feature/unmerged so it loses commits can't be undone")
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
    assert.strictEqual(guardStopIn(run(work, 'git', 'branch', '-D', 'feature/unmerged').said), 'delete-branch')
    assert.strictEqual(guardStopIn(run(work, 'git', 'push', 'origin', 'althar/retry').said), undefined)
  })

  it('lets a branch go whose commits are on another, as `git branch -d` does for work that is merged', () => {
    const { work } = repository()
    // feature/other's commit is on main and on the remote's feature/other: nothing is lost here.
    const deleted = run(work, 'git', 'branch', '-d', 'feature/other')
    assert.strictEqual(deleted.status, 0, deleted.said)
    assert.strictEqual(run(work, 'git', 'branch', '--list', 'feature/other').said.trim(), '')
    // Nor moving a branch back to where its commits are kept: feature/unmerged's own commit is first kept on a tag.
    run(work, 'git', 'tag', 'kept', 'feature/unmerged')
    assert.strictEqual(run(work, 'git', 'branch', '-f', 'feature/unmerged', 'main').status, 0)
  })

  it('leaves a repository that isn’t the task’s alone: a scratch one in the temp folder is the lead’s', () => {
    const task = repository()
    const scratch = repository()
    const own = {
      ...env,
      ...guardEnv({ sessionId, taskBranch: 'althar/retry', defaultBranches: ['main'], repositories: [task.work], count: 0, at }),
    }
    const ran = (cwd: string, ...args: Array<string>) => {
      const done = spawnSync('git', args, { cwd, env: own, encoding: 'utf8' })
      return { status: done.status, said: `${done.stdout}${done.stderr}` }
    }
    assert.strictEqual(ran(scratch.work, 'push', '-q', 'origin', 'althar/retry:main').status, 0)
    assert.strictEqual(ran(scratch.work, 'branch', '-D', 'feature/unmerged').status, 0)
    // The task's own, from any worktree of it, is guarded as before.
    const worktree = join(task.home, 'second')
    ran(task.work, 'worktree', 'add', '-q', '--detach', worktree)
    for (const cwd of [task.work, worktree]) {
      const stopped = ran(cwd, 'push', 'origin', 'althar/retry:main')
      assert.notStrictEqual(stopped.status, 0, cwd)
      assert.include(stopped.said, 'a push to main, the default branch', cwd)
    }
    // A scratch repository pushing to one of the task's remotes is stopped, as the task's own would be.
    ran(scratch.work, 'remote', 'add', 'task', join(task.home, 'remote.git'))
    const back = ran(scratch.work, 'push', 'task', 'althar/retry:main')
    assert.notStrictEqual(back.status, 0)
    assert.include(back.said, 'a push to main, the default branch')
  })

  // No guard on Windows, where Git for Windows' `ps` can't show git's own words (guardHolds).
  it.skipIf(!guardHolds)('lets through the one git the person allowed, once, and nothing else on its pass', () => {
    const { work } = repository()
    const allowed = 'git push -q origin althar/retry:main'
    passGuard(sessionId, runsOf(`${allowed} 2>&1`, work), at)
    // Another irreversible git, in a script or plainly, gets nothing from it.
    const other = run(
      work,
      'python3',
      '-c',
      "import subprocess, sys; sys.exit(subprocess.run(['git', 'push', 'origin', '--delete', 'feature/other']).returncode)",
    )
    assert.notStrictEqual(other.status, 0)
    assert.include(other.said, 'deleting feature/other on origin')
    assert.notStrictEqual(run(work, 'git', 'branch', '-D', 'feature/unmerged').status, 0)
    // What was allowed goes, once.
    assert.strictEqual(run(work, 'git', ...allowed.split(' ').slice(1)).status, 0, 'the allowed push')
    run(work, 'git', 'commit', '-q', '--allow-empty', '-m', 'Again')
    const again = run(work, 'git', ...allowed.split(' ').slice(1))
    assert.notStrictEqual(again.status, 0, 'its pass was spent on the first')
    assert.include(again.said, 'a push to main, the default branch')
  })

  it.skipIf(!guardHolds)('lets through what was allowed only in its repository, and only to where its remote pointed then', () => {
    const one = repository()
    const two = repository()
    const allowed = 'git push -q origin althar/retry:main'
    passGuard(sessionId, runsOf(allowed, one.work), at)
    // The same words in another repository of the task get nothing from it, and leave it unspent.
    const elsewhere = run(two.work, 'git', ...allowed.split(' ').slice(1))
    assert.notStrictEqual(elsewhere.status, 0, 'the same push in another repository')
    assert.include(elsewhere.said, 'a push to main, the default branch')
    assert.strictEqual(run(one.work, 'git', ...allowed.split(' ').slice(1)).status, 0, 'the allowed push')
    // A remote pointed elsewhere after the person allowed it is another crossing.
    passGuard(sessionId, runsOf(allowed, one.work), at)
    run(one.work, 'git', 'remote', 'set-url', 'origin', join(two.home, 'remote.git'))
    run(one.work, 'git', 'commit', '-q', '--allow-empty', '-m', 'Again')
    const moved = run(one.work, 'git', ...allowed.split(' ').slice(1))
    assert.notStrictEqual(moved.status, 0, 'the push to a remote pointed elsewhere')
    // A line that goes into the other repository first is allowed there, and only there.
    passGuard(sessionId, runsOf(`cd '${two.work}' && ${allowed}`, one.work), at)
    assert.notStrictEqual(run(one.work, 'git', ...allowed.split(' ').slice(1)).status, 0, 'where it didn’t go')
    assert.strictEqual(run(two.work, 'git', ...allowed.split(' ').slice(1)).status, 0, 'where it went')
  })
})

describe('the git commands a pass names', () => {
  it('are git’s own words: unquoted, without the shell’s redirects or assignments', () => {
    const words = (line: string) => runsOf(line, '/work/meridian').map((each) => each.words)
    assert.deepStrictEqual(words(`git push --force origin 'althar/retry' 2>&1 | tail -3`), ['git push --force origin althar/retry'])
    assert.deepStrictEqual(words('GIT_TRACE=1 /usr/bin/git  push origin HEAD:main && echo done'), ['git push origin HEAD:main'])
    assert.deepStrictEqual(words('ls'), [])
  })

  it('run where the line says: after its `cd`s and `-C`, with the remote a push names', () => {
    const { home, work } = repository()
    assert.deepStrictEqual(runsOf('git push origin HEAD:main', work), [
      { words: 'git push origin HEAD:main', folder: work, push: { remote: 'origin' } },
    ])
    assert.strictEqual(runsOf(`cd '${home}' && git -C work branch -D feature/other`, work)[0]?.folder, work)
    assert.deepStrictEqual(runsOf('git push --repo=upstream -f', work)[0]?.push, { remote: 'upstream' })
    assert.deepStrictEqual(runsOf('git push', work)[0]?.push, { remote: undefined })
    // Where Althar can't tell the folder, the pass names none, and the guard lets nothing through on it.
    assert.strictEqual(runsOf('cd "$(cat where)" && git push origin HEAD:main', work)[0]?.folder, undefined)
  })
})

describe('a pass past the guard, as written for the hook', () => {
  const passed = (sessionId: string, runs: Parameters<typeof passGuard>[1]) => {
    const at = { hooks: mkdtempSync(join(tmpdir(), 'althar-hooks-')), passes: mkdtempSync(join(tmpdir(), 'althar-passes-')) }
    passGuard(sessionId, runs, at)
    const file = join(at.passes, sessionId)
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }
  const repo = () => {
    const work = realpathSync(mkdtempSync(join(tmpdir(), 'althar-pass-')))
    execFileSync('git', ['init', '-q', '-b', 'main', work])
    return work
  }

  it('names where a push goes: the remote named, else the branch’s push remote as its config says, else origin', () => {
    const work = repo()
    execFileSync('git', ['-C', work, 'remote', 'add', 'origin', 'https://example.test/a.git'])
    execFileSync('git', ['-C', work, 'remote', 'add', 'fork', 'https://example.test/fork.git'])
    const push = (remote: string | undefined) => [{ words: 'git push', folder: work, push: { remote } }]
    assert.strictEqual(passed('s1', push(undefined)), `${work}\thttps://example.test/a.git\tgit push\n`)
    assert.strictEqual(passed('s2', push('fork')), `${work}\thttps://example.test/fork.git\tgit push\n`)
    // A remote it doesn't have is passed as it is named: a URL or a path.
    assert.strictEqual(passed('s3', push('/srv/bare.git')), `${work}\t/srv/bare.git\tgit push\n`)
    execFileSync('git', ['-C', work, 'config', 'remote.pushDefault', 'fork'])
    assert.strictEqual(passed('s4', push(undefined)), `${work}\thttps://example.test/fork.git\tgit push\n`)
    // Not a push: its repository alone.
    assert.strictEqual(passed('s5', [{ words: 'git reset --hard', folder: work }]), `${work}\t\tgit reset --hard\n`)
  })

  it('writes none for a git whose repository Althar can’t tell', () => {
    assert.isNull(passed('s6', [{ words: 'git push', folder: undefined, push: { remote: 'origin' } }]))
    assert.isNull(passed('s7', [{ words: 'git push', folder: mkdtempSync(join(tmpdir(), 'althar-not-git-')) }]))
  })
})
