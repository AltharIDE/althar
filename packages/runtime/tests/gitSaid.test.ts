import { assert, describe, it } from '@effect/vitest'
import { Cause } from 'effect'

import { GitFailed } from '../src/errors'
import { gitFields, gitLine, gitSummary, homeShortened, redacted, subcommandOf } from '../src/gitSaid'
import { summarize, words } from '../src/words'

/*
 * What git said when it failed, in a line (gitSaid.ts): its subcommand and
 * the line of its stderr that says most, the home folder as `~`, with
 * nothing that signs Althar in left in it, wherever it is shown or logged.
 */

const HOME = '/home/someone'

const failed = (args: ReadonlyArray<string>, stderr: string, more: Partial<ConstructorParameters<typeof GitFailed>[0]> = {}) =>
  new GitFailed({ args: [...args], cwd: `${HOME}/projects/orchy`, stderr, ...more })

describe('a git failure in a line', () => {
  it('names the subcommand and git’s fatal line, the home folder shortened', () => {
    assert.strictEqual(
      gitSummary(
        failed(
          ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
          `fatal: gitfile does not point to a valid repository: ${HOME}/.local/share/althar/worktrees/orchy/fix-login/orchy/.git`,
        ),
        HOME,
      ),
      'git rev-parse: gitfile does not point to a valid repository: ~/.local/share/althar/worktrees/orchy/fix-login/orchy/.git',
    )
  })

  it('prefers the fatal line to what git said around it', () => {
    const stderr = [
      'remote: Repository not found.',
      "fatal: repository 'https://github.com/acme/orchy.git/' not found",
      'hint: check the URL',
    ].join('\n')
    assert.strictEqual(
      gitSummary(failed(['fetch', '--quiet', 'https://github.com/acme/orchy.git'], stderr), HOME),
      "git fetch: repository 'https://github.com/acme/orchy.git/' not found",
    )
  })

  it('takes the error line where there is no fatal one', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '\tsrc/a.ts',
      'Please commit your changes or stash them before you merge.',
      'Aborting',
    ].join('\n')
    assert.strictEqual(
      gitSummary(failed(['merge', '--no-edit', 'origin/main'], stderr), HOME),
      'git merge: Your local changes to the following files would be overwritten by merge:',
    )
  })

  it('leaves out the advice after a remote it couldn’t read, for what ssh said', () => {
    const stderr = [
      'git@github.com: Permission denied (publickey).',
      'fatal: Could not read from remote repository.',
      '',
      'Please make sure you have the correct access rights',
      'and the repository exists.',
    ].join('\n')
    assert.strictEqual(gitSummary(failed(['fetch', 'origin'], stderr), HOME), 'git fetch: git@github.com: Permission denied (publickey).')
  })

  it('reads a ref git couldn’t find, and the last line where nothing is marked', () => {
    assert.strictEqual(
      gitSummary(failed(['fetch', 'origin', '+refs/heads/nope:refs/x'], "fatal: couldn't find remote ref refs/heads/nope"), HOME),
      "git fetch: couldn't find remote ref refs/heads/nope",
    )
    assert.strictEqual(
      gitSummary(failed(['worktree', 'add', 'x'], 'Preparing worktree (new branch)\nsomething went wrong'), HOME),
      'git worktree: something went wrong',
    )
  })

  it('reads what git said before its usage, not the usage', () => {
    const stderr = [
      'warning: Not a git repository. Use --no-index to compare two paths outside a working tree',
      'usage: git diff --no-index [<options>] <path> <path>',
      '',
      'Diff output format options',
      '    --output <file>       output to a specific file',
    ].join('\n')
    assert.strictEqual(
      gitSummary(failed(['diff', '--name-only'], stderr), HOME),
      'git diff: Not a git repository. Use --no-index to compare two paths outside a working tree',
    )
  })

  it('says how it ended where git said nothing', () => {
    assert.strictEqual(
      gitSummary(failed(['rev-parse', '--verify', '--quiet', 'nope'], '', { code: 1 }), HOME),
      'git rev-parse: failed with code 1',
    )
    assert.strictEqual(
      gitSummary(failed(['fetch', 'origin'], '', { timedOut: true, timeout: 120_000 }), HOME),
      'git fetch: no answer in 120 s',
    )
    assert.strictEqual(gitSummary(failed(['status'], '', { signal: 'SIGTERM' }), HOME), 'git status: stopped by SIGTERM')
    assert.strictEqual(
      gitSummary(failed(['status'], '', { reason: 'git said more than Althar reads.' }), HOME),
      'git status: git said more than Althar reads',
    )
  })

  it('finds the subcommand past options before it', () => {
    assert.strictEqual(subcommandOf(['-c', 'core.hooksPath=/dev/null', 'status', '--short']), 'status')
    assert.strictEqual(subcommandOf(['--git-dir', '/x/.git', '--work-tree', '/x', 'diff']), 'diff')
  })

  it('cuts a very long line short', () => {
    const said = gitLine(`fatal: ${'x'.repeat(500)}`, HOME)
    assert.isAtMost(said.length, 240)
    assert.isTrue(said.endsWith('…'))
  })

  it('shortens the home folder only where it is one', () => {
    assert.strictEqual(homeShortened(`${HOME}/a and ${HOME}-other/b`, HOME), `~/a and ${HOME}-other/b`)
  })

  it('is a GitFailed’s message, so a cause pretty-printed for the log says it', () => {
    const error = failed(['rev-parse', 'HEAD'], 'fatal: not a git repository: /x/.git')
    assert.strictEqual(error.message, 'git rev-parse: not a git repository: /x/.git')
    assert.match(Cause.pretty(Cause.fail(error)).split('\n')[0] ?? '', /^GitFailed: git rev-parse: not a git repository/)
  })

  it('sums a cause up for a card, where it once said only “GitFailed:”', () => {
    const cause = Cause.fail(
      failed(['worktree', 'add', '--detach', '/x'], 'fatal: gitfile does not point to a valid repository: /w/orchy/.git'),
    )
    assert.strictEqual(summarize(cause), 'git worktree: gitfile does not point to a valid repository: /w/orchy/.git.')
  })
})

describe('what is shown or logged of a git failure keeps no secret', () => {
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')

  it('blanks Authorization headers, extraHeader values and what GIT_CONFIG_VALUE carries', () => {
    for (const text of [
      `Authorization: Basic ${basic}`,
      `> authorization: bearer ${token}`,
      `-c http.extraHeader=AUTHORIZATION: basic ${basic}`,
      `http.https://github.com/.extraheader AUTHORIZATION: basic ${basic}`,
      `GIT_CONFIG_VALUE_0=AUTHORIZATION: basic ${basic}`,
    ]) {
      const out = redacted(text)
      assert.notInclude(out, basic, text)
      assert.notInclude(out, token, text)
      assert.include(out, '[redacted]', text)
    }
  })

  it('blanks credentials in a URL, keeping its host', () => {
    assert.strictEqual(
      redacted("fatal: unable to access 'https://x-access-token:s3cret@github.com/acme/orchy.git/': The requested URL returned error: 403"),
      "fatal: unable to access 'https://[redacted]@github.com/acme/orchy.git/': The requested URL returned error: 403",
    )
  })

  it('blanks anything shaped like a token', () => {
    for (const secret of [
      token,
      'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
      'glpat-' + 'abcdefghijklmnopqrst',
      'lin_api_' + 'abcdefghijklmnopqrstuvwxyz0123',
      'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'Zk9vYmFyQmF6UXV4' + 'MTIzNDU2Nzg5MEFiQ2RFZkdo',
    ])
      assert.notInclude(redacted(`said ${secret} there`), secret, secret)
  })

  it('keeps commit ids, branches and the paths of tasks', () => {
    for (const text of [
      'fatal: bad object 3f786850e387550fdab836ed7e6dc881de23001b',
      'error: cannot lock ref refs/heads/althar/dev-188-pass-the-persons-skills-through-and-show-what-agents-used',
      'fatal: gitfile does not point to a valid repository: ~/worktrees/orchy/show-git-s-error-on-failures-repair-broken-workt/orchy/.git',
    ])
      assert.strictEqual(redacted(text), text)
  })

  it('leaves none in the summary, the window’s words, the message or the log’s fields', () => {
    const error = new GitFailed({
      args: ['-c', `http.extraHeader=AUTHORIZATION: basic ${basic}`, 'fetch', `https://bot:${token}@github.com/acme/orchy.git`],
      cwd: '/w',
      stderr: [
        `> GET /acme/orchy.git/info/refs HTTP/1.1`,
        `> Authorization: Basic ${basic}`,
        `fatal: unable to access 'https://bot:${token}@github.com/acme/orchy.git/': The requested URL returned error: 403`,
      ].join('\n'),
    })
    const cause = Cause.fail(error)
    const said = words(error, (id) => id)
    for (const out of [
      gitSummary(error),
      error.message,
      summarize(cause),
      said.message,
      said.detail ?? '',
      ...Object.values(gitFields(cause)),
    ]) {
      assert.notInclude(out, token)
      assert.notInclude(out, basic)
    }
    assert.strictEqual(
      gitSummary(error),
      "git fetch: unable to access 'https://[redacted]@github.com/acme/orchy.git/': The requested URL returned error: 403",
    )
  })
})

describe('the log’s fields for a git failure', () => {
  it('keeps its arguments, where it ran and all git said', () => {
    const cause = Cause.fail(
      new GitFailed({ args: ['rev-parse', 'HEAD'], cwd: '/w/orchy', stderr: 'fatal: not a git repository: /w/.git', code: 128 }),
    )
    assert.deepStrictEqual(gitFields(cause), {
      git_args: 'rev-parse HEAD',
      git_cwd: '/w/orchy',
      git_stderr: 'fatal: not a git repository: /w/.git',
      git_code: '128',
    })
  })

  it('hides a secret in where it ran, as in its arguments and what git said', () => {
    const token = 'glpat-' + 'A1b2C3d4E5f6G7h8I9j0'
    const fields = gitFields(Cause.fail(new GitFailed({ args: ['status'], cwd: `/w/${token}/orchy`, stderr: '' })))
    assert.strictEqual(fields['git_cwd'], '/w/[redacted]/orchy')
  })

  it('has none for another cause', () => {
    assert.deepStrictEqual(gitFields(Cause.fail(new Error('other'))), {})
  })
})
