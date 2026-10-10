import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PermissionRequest } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import {
  ALTHAR_TOOL,
  commandOf,
  decide,
  decideReader,
  essentials,
  matchesPattern,
  MVP_RULES,
  RULES,
  parseCommandLine,
  pathsOf,
  type ProjectRuleSet,
  type RuleContext,
  sayRules,
} from '../src/rules'

const worktree = '/work/meridian/retry/app'
const context: RuleContext = { worktree, defaultBranch: 'main', taskBranch: 'althar/retry', currentBranch: 'althar/retry' }

const request = (fields: Partial<PermissionRequest>): PermissionRequest => ({
  sessionId: 's',
  toolCallId: 't',
  title: '',
  kind: 'execute',
  paths: [],
  options: [],
  ...fields,
})

const run = (command: string, overrides: Partial<RuleContext> = {}) => decide(request({ title: command }), { ...context, ...overrides })

describe('the coordinator decides', () => {
  const project: ProjectRuleSet = { mode: 'coordinator', ask: ['deploy'], never: ['force-push'], commands: [] }

  it('judges requests outside the explicit lists', () => {
    assert.strictEqual(run('npm test', { project }).verdict, 'judge')
    assert.strictEqual(run('git push origin althar/retry', { project }).verdict, 'judge')
  })

  it('cannot override always-ask, never, command rules, or the code-host boundary', () => {
    assert.strictEqual(run('npm publish', { project }).verdict, 'ask')
    assert.strictEqual(run('git push --force origin main', { project }).verdict, 'deny')
    assert.strictEqual(run('gh pr merge 12', { project }).verdict, 'deny')
    assert.strictEqual(run('npm test', { project: { ...project, commands: [{ pattern: 'npm test', decision: 'ask' }] } }).verdict, 'ask')
    assert.strictEqual(run('npm test', { project: { ...project, commands: [{ pattern: 'npm test', decision: 'never' }] } }).verdict, 'deny')
    assert.strictEqual(run('git push origin $(git branch --show-current)', { project }).verdict, 'ask')
  })
})

describe('a code host, reached only through Althar', () => {
  it.each([
    ['gh pr view 12', undefined],
    ['gh pr list --state open', undefined],
    ['gh pr checks', undefined],
    ['gh pr diff 12', undefined],
    ['gh run view 123 --log-failed', undefined],
    ['gh issue view 7', undefined],
    ['gh api repos/meridian/api/pulls/12/comments', undefined],
    ['glab mr view 4', undefined],
    ['glab ci trace', undefined],
    ['gh --version', undefined],
    ['gh pr create --help', undefined],
    ['gh', undefined],
    ['gh pr create --fill', 'the person pushes'],
    ['gh pr edit 12 --title x', 'the person pushes'],
    ['gh pr ready 12', 'the person pushes'],
    ['glab mr create', 'the person pushes'],
    ['gh pr comment 12 --body done', 'reply_on_pull_request'],
    ['gh pr review 12 --approve', 'reply_on_pull_request'],
    ['glab mr note 4 -m x', 'reply_on_pull_request'],
    ['gh pr merge 12 --squash', "Merging is the person's to do"],
    ['glab mr merge 4', "Merging is the person's to do"],
    ['gh issue create --title x', 'read_issue'],
    ['gh issue close 7', 'read_issue'],
    ['gh auth login', "without the person's sign-in"],
    ['gh api -X POST repos/meridian/api/issues', "Agents don't change things on the code host"],
    ['gh api repos/meridian/api/issues -f title=x', "Agents don't change things on the code host"],
    ['gh api --method=PATCH repos/x', "Agents don't change things on the code host"],
    ['gh api -XPOST repos/meridian/api/issues', "Agents don't change things on the code host"],
    ['gh release delete v1', "Agents don't change things on the code host"],
    ['gh workflow run deploy.yml', "Agents don't change things on the code host"],
    ['gh -R meridian/api pr create', "Agents don't change things on the code host"],
    ['cd sub && /opt/homebrew/bin/gh pr create', 'the person pushes'],
    ['GH_CONFIG_DIR=~/.config/gh gh pr create', 'the person pushes'],
    ['bash -lc "git commit -am x && gh pr create"', 'the person pushes'],
    // Credentials are the person's: the keychain, and git's helpers, whichever way they're asked.
    ['security find-generic-password -s Althar -w', "don't read the person's credentials"],
    ['/usr/bin/security dump-keychain', "don't read the person's credentials"],
    ["printf 'host=github.com\\n' | git credential fill", "don't read the person's credentials"],
    ['git -C /w -c x=y credential-osxkeychain get', "don't read the person's credentials"],
    ['git-credential-osxkeychain get', "don't read the person's credentials"],
    ['git config --get credential.helper', undefined],
    ['git commit -m credential', undefined],
  ])('%s: %s', (command, refused) => {
    const verdict = run(command)
    if (refused === undefined) assert.notStrictEqual(verdict.verdict, 'deny')
    else {
      assert.strictEqual(verdict.verdict, 'deny')
      assert.include(verdict.verdict === 'deny' ? verdict.reason : '', refused)
    }
  })
})

describe('reading commands', () => {
  it('splits commands and words as a shell would', () => {
    assert.deepStrictEqual(parseCommandLine(`cd "my dir" && git commit -m 'it is done'; echo a\\ b | tee x 2>&1`), {
      commands: [
        ['cd', 'my dir'],
        ['git', 'commit', '-m', 'it is done'],
        ['echo', 'a b'],
        ['tee', 'x', '2>', '&1'],
      ],
      opaque: false,
    })
    assert.deepStrictEqual(parseCommandLine(`bash -lc "git add . && git push"`).commands, [
      ['git', 'add', '.'],
      ['git', 'push'],
    ])
    assert.deepStrictEqual(parseCommandLine('FOO=1 sudo -u me env git status').commands, [['git', 'status']])
    assert.deepStrictEqual(parseCommandLine('echo "a \\"b\\" $x"').commands, [['echo', 'a "b" $x']])
    assert.isTrue(parseCommandLine('git push origin $(git branch --show-current)').opaque)
    assert.isTrue(parseCommandLine('echo "`date`"').opaque)
    assert.isTrue(parseCommandLine('sh -c "echo $(whoami)"').opaque)
    assert.isTrue(parseCommandLine('eval "$CMD"').opaque)
    assert.deepStrictEqual(parseCommandLine("echo 'unclosed").commands, [['echo', 'unclosed']])
  })

  it('reads the command from the raw input when the agent gives one', () => {
    assert.strictEqual(commandOf(request({ title: 'Run a command', rawInput: { command: 'git push --force' } })), 'git push --force')
    assert.strictEqual(
      commandOf(request({ title: 'Run', rawInput: { command: ['bash', '-lc', 'make deploy'] } })),
      "bash -lc 'make deploy'",
    )
    assert.strictEqual(commandOf(request({ title: 'git status', rawInput: { command: 42 } })), 'git status')
  })

  it('collects every path an action names, once', () => {
    assert.deepStrictEqual(
      pathsOf(request({ paths: ['a.ts'], rawInput: { path: 'a.ts', filePath: 'b.ts', old_path: '', other: 'c.ts' } })),
      ['a.ts', 'b.ts'],
    )
    assert.deepStrictEqual(pathsOf(request({ rawInput: { changes: { 'src/a.ts': { add: {} }, '/etc/hosts': {} } } })), [
      'src/a.ts',
      '/etc/hosts',
    ])
    assert.deepStrictEqual(pathsOf(request({ rawInput: { changes: [{ path: 'x.ts' }, { kind: 'y' }] } })), ['x.ts'])
  })
})

describe('the always-ask list', () => {
  it.each([
    'bun test',
    'git status',
    'git add -- notes.txt',
    "git commit -m 'Add notes'",
    'git push',
    'git push -u origin HEAD',
    'git push origin althar/retry',
    'git push origin HEAD:refs/heads/althar/retry',
    'git push origin althar/main-fix',
    'git push origin --delete althar/retry',
    `git -C ${worktree} push origin althar/retry`,
    'git merge main',
    'npm run build 2>&1 | tee build.log',
    'rm -rf node_modules dist',
    'mkdir -p src/lib && cp README.md src/lib/',
    'echo done > /tmp/althar-note',
    'npm test 2>/dev/null',
    "sed -i '' 's/a/b/' src/app.ts",
    'git clone https://github.com/meridian/lib vendor/lib',
  ])('allows %s', (command) => {
    assert.deepStrictEqual(run(command), { verdict: 'allow' })
  })

  it.each([
    ['git push origin main', 'A push to main always asks.'],
    ['git push origin HEAD:main', 'A push to main always asks.'],
    ['git push origin HEAD:refs/heads/main', 'A push to main always asks.'],
    [`git -C ${worktree} push origin main`, 'A push to main always asks.'],
    ['cd sub && git push origin main', 'A push to main always asks.'],
    ['bash -lc "git push origin main"', 'A push to main always asks.'],
    ['git push --all origin', 'Pushing every branch always asks.'],
    ['git push --mirror', 'Pushing every branch always asks.'],
    ['git push origin :main', 'Deleting main always asks.'],
    ['git push origin --delete main', 'Deleting main always asks.'],
    ['git push origin --delete someone/feature', "Deleting someone/feature, which isn't this task's branch, always asks."],
    ['git push --force', 'A force push always asks.'],
    ['git push -uf origin althar/retry', 'A force push always asks.'],
    ['git push --force-with-lease', 'A force push always asks.'],
    ['git push origin +althar/retry', 'A force push always asks.'],
    ['git push --tags', 'Pushing tags always asks; they often start a release.'],
    ['git push origin v1.2.0:refs/tags/v1.2.0', 'Pushing tags always asks; they often start a release.'],
    ['git push --prune origin', 'A push that deletes remote branches always asks.'],
    ['git push origin "refs/heads/*"', 'A push to a pattern of branches always asks.'],
    ['git push origin :', 'A push of matching branches always asks.'],
    ['git push origin HEAD:refs/notes/x', "Althar can't tell what `refs/notes/x` is, so it asks."],
    ['git push --weird origin', "Althar can't tell what `--weird` does to a push, so it asks."],
    ['git push origin $(git branch --show-current)', "Althar can't tell what this command does until it runs, so it asks."],
    ['make deploy', 'Deploying or publishing always asks.'],
    ['npx wrangler deploy', 'Deploying or publishing always asks.'],
    ['vercel --prod', 'Deploying or publishing always asks.'],
    ['kubectl apply -f prod.yaml', 'Deploying or publishing always asks.'],
    ['terraform apply', 'Deploying or publishing always asks.'],
    ['npm publish', 'Deploying or publishing always asks.'],
    ['git -C /Users/someone/other commit -m x', 'Git in another folder always asks: /Users/someone/other'],
    ['git --git-dir=/elsewhere/.git log', 'Git in another folder always asks: /elsewhere/.git'],
    ['cd ~/other && git commit -m x', 'Git in another folder always asks:'],
    ['echo x >> ~/.zshrc', "Writing outside the task's worktree always asks:"],
    ['touch ~/althar-probe.txt', "Writing outside the task's worktree always asks:"],
    ['cp .env /Users/someone/leak.env', "Writing outside the task's worktree always asks: /Users/someone/leak.env"],
    ['dd if=/dev/zero of=/etc/x', "Writing outside the task's worktree always asks: /etc/x"],
    ['git worktree add ../elsewhere', "Writing outside the task's worktree always asks: ../elsewhere"],
  ])('asks about %s', (command, reason) => {
    const verdict = run(command)
    assert.strictEqual(verdict.verdict, 'ask')
    assert.include(verdict.verdict === 'ask' ? verdict.reason : '', reason)
  })

  it('checks the default branch the project has', () => {
    assert.strictEqual(run('git push origin trunk', { defaultBranch: 'trunk' }).verdict, 'ask')
    assert.strictEqual(run('git push origin main', { defaultBranch: 'trunk' }).verdict, 'allow')
  })

  it('asks where a push goes when it can’t tell which branch is checked out', () => {
    const { currentBranch: _, ...unknown } = context
    for (const command of ['git push', 'git push origin HEAD', 'git push -u origin HEAD:HEAD', 'git push --delete origin']) {
      assert.strictEqual(decide(request({ title: command }), unknown).verdict, 'ask', command)
    }
    assert.strictEqual(run('git push', { currentBranch: 'main' }).verdict, 'ask')
  })

  it('reads a Codex command from its words', () => {
    const codex = (command: ReadonlyArray<string>) => decide(request({ title: command.join(' '), rawInput: { command } }), context)
    assert.strictEqual(codex(['bash', '-lc', 'git add -- notes.txt']).verdict, 'allow')
    assert.strictEqual(codex(['bash', '-lc', "git commit -m 'Add notes' --only -- notes.txt"]).verdict, 'allow')
    assert.strictEqual(codex(['/bin/zsh', '-c', 'git push origin main']).verdict, 'ask')
    assert.strictEqual(decide(request({ kind: 'other', title: 'Terminal', rawInput: { cmd: 'npm publish' } }), context).verdict, 'ask')
  })
})

describe('less usual commands', () => {
  it.each([
    ['git -c color.ui=never --no-pager push origin main', 'ask'],
    ['sudo -u me git push origin main', 'ask'],
    ['sudo -E git push origin main', 'ask'],
    ['git --git-dir /elsewhere/.git status', 'ask'],
    ['git --work-tree=/elsewhere status', 'ask'],
    ['git push --repo origin -o ci.skip origin althar/retry', 'allow'],
    ['git push --push-option=ci.skip origin althar/retry', 'allow'],
    ['ln -s /usr/local/bin/node node', 'allow'],
    ['ln -s node /usr/local/bin/node', 'ask'],
    ['install -m 755 build/tool ~/bin/tool', 'ask'],
    ['cd && git status', 'ask'],
    ['bash -c', 'allow'],
    ['git', 'allow'],
    ['echo "unclosed', 'allow'],
    ['echo trailing\\', 'allow'],
    ['cat <<< x > out.txt', 'allow'],
    ['make build &> build.log', 'allow'],
    ['echo x >&2', 'allow'],
    ['sleep 1 & git push origin main', 'ask'],
  ])('%s: %s', (command, verdict) => {
    assert.strictEqual(run(command).verdict, verdict)
  })
})

describe('edits', () => {
  const edit = (fields: Partial<PermissionRequest>, overrides: Partial<RuleContext> = {}) =>
    decide(request({ kind: 'edit', title: 'Edit', ...fields }), { ...context, ...overrides })

  it('allows edits inside the worktree, and asks about the rest', () => {
    assert.deepStrictEqual(edit({ paths: ['src/app.ts'] }), { verdict: 'allow' })
    assert.deepStrictEqual(edit({ paths: [`${worktree}/src/app.ts`] }), { verdict: 'allow' })
    assert.deepStrictEqual(edit({ rawInput: { file_path: '/Users/someone/.zshrc' } }), {
      verdict: 'ask',
      reason: "Writing outside the task's worktree always asks: /Users/someone/.zshrc",
    })
    assert.strictEqual(edit({ paths: ['../other/file.ts'] }).verdict, 'ask')
    assert.strictEqual(edit({ rawInput: { changes: { '/etc/hosts': {} } } }).verdict, 'ask')
    assert.strictEqual(decide(request({ kind: 'move', rawInput: { new_path: '/Users/someone/x' } }), context).verdict, 'ask')
    assert.strictEqual(decide(request({ kind: 'delete', paths: [worktree] }), context).verdict, 'allow')
    assert.strictEqual(decide(request({ kind: 'read', paths: ['/etc/hosts'] }), context).verdict, 'allow')
  })

  it('asks when it can’t tell where an edit writes', () => {
    assert.deepStrictEqual(edit({ rawInput: { somewhere: '/etc/hosts' } }), {
      verdict: 'ask',
      reason: "Althar can't tell where this edit writes, so it asks.",
    })
    assert.strictEqual(decide(request({ kind: 'delete' }), context).verdict, 'ask')
  })

  it('follows symlinks out of the worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-rules-'))
    const tree = join(root, 'tree')
    const away = join(root, 'away')
    mkdirSync(tree)
    mkdirSync(away)
    symlinkSync(away, join(tree, 'link'))
    const real: Partial<RuleContext> = { worktree: tree, scratch: [] }
    assert.strictEqual(edit({ paths: [join(tree, 'src', 'new.ts')] }, real).verdict, 'allow')
    assert.strictEqual(edit({ paths: [join(tree, 'link', 'file.ts')] }, real).verdict, 'ask')
    assert.strictEqual(edit({ paths: ['link/nested/new.ts'] }, { ...real }).verdict, 'ask')
    assert.strictEqual(run(`echo x > ${join(tree, 'link', 'f')}`, real).verdict, 'ask')
  })
})

describe('what the record keeps', () => {
  it("keeps a call's command and paths, and names what it leaves out", () => {
    assert.deepStrictEqual(essentials({ command: 'bun test', cwd: '/w', description: 'Run the tests' }), {
      input: { command: 'bun test' },
      cut: ['cwd', 'description'],
    })
    assert.deepStrictEqual(essentials({ file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }), {
      input: { file_path: '/w/a.ts' },
      cut: ['old_string', 'new_string'],
    })
    assert.deepStrictEqual(essentials({ changes: { 'src/a.ts': { add: { content: 'secret' } } } }), {
      input: { changes: { 'src/a.ts': {} } },
      cut: ['changes (contents)'],
    })
    assert.deepStrictEqual(essentials({ changes: [{ path: 'x.ts', diff: '+secret' }] }).input, { changes: [{ path: 'x.ts' }] })
    assert.deepStrictEqual(essentials({ cmd: ['bash', '-lc', 'make'] }).input, { cmd: ['bash', '-lc', 'make'] })
    assert.deepStrictEqual(essentials({ command: 42, path: 7 }), { input: {}, cut: ['command', 'path'] })
    const long = essentials({ command: `cat > big <<'EOF'\n${'x'.repeat(5_000)}\nEOF` })
    assert.strictEqual(String(long.input.command).length, 4_001)
    assert.deepStrictEqual(long.cut, ['command after 4000 characters'])
    assert.deepStrictEqual(essentials(undefined), { input: {}, cut: [] })
    assert.deepStrictEqual(essentials('plain text'), { input: {}, cut: ['input'] })
    // What the record keeps is still enough for the rules and the window to read.
    assert.strictEqual(
      commandOf(request({ rawInput: essentials({ command: 'git push origin main', cwd: '/w' }).input })),
      'git push origin main',
    )
  })
})

describe('a role that only reads', () => {
  const verdict = (fields: Partial<PermissionRequest>) => decideReader(request(fields)).verdict

  it("calls Althar's own tools, as each agent names them", () => {
    for (const title of ['mcp__althar__draft_task', 'mcp.althar.propose_plan', 'althar_list_tasks'])
      assert.strictEqual(verdict({ kind: 'other', title }), 'allow', title)
    assert.isFalse(ALTHAR_TOOL.test('mcp__github__create_issue'))
    assert.strictEqual(verdict({ kind: 'other', title: 'mcp__github__create_issue' }), 'deny')
  })

  it('reads, searches and fetches, and runs what only looks', () => {
    for (const kind of ['read', 'search', 'think', 'fetch'] as const) assert.strictEqual(verdict({ kind, title: 'Look' }), 'allow', kind)
    for (const command of [
      'git log --oneline -20',
      'git diff main -- src',
      'cd src && rg "retry" | head -20',
      'git branch -a',
      'git stash list',
      'find . -name "*.ts" -newer package.json',
      'sed -n 1,40p src/checkout.ts',
      "sed -n '/export/p' src/checkout.ts",
      'ls -la > /dev/null',
      'rg -n -i --type ts -g "!dist" "retry" src',
      'rg -C3 --hidden retry',
      'fd -t f -e ts retry src',
      'sort -n -k 2 counts.txt | uniq -c',
      'uniq -c counts.txt',
      'tree -L 2 -I node_modules',
      'git stash list',
      'git stash show -p stash@{0}',
      'git reflog show --oneline',
      'git -C ../other --no-pager log -1',
      'git diff --stat main',
      'date -u +%Y',
      'git',
      'rg -e retry -- src',
      'rg --max-count=2 retry',
      'uniq -f 2 counts.txt',
      'sort -k2 counts.txt',
      'file -b --mime README.md',
      '/usr/bin/env',
    ])
      assert.strictEqual(verdict({ kind: 'execute', title: command, rawInput: { command } }), 'allow', command)
  })

  it('refuses every write, and what it cannot tell, with a reason', () => {
    for (const kind of ['edit', 'delete', 'move'] as const) assert.strictEqual(verdict({ kind, title: 'Change it' }), 'deny', kind)
    const reasons = [
      'echo hi > notes.md',
      'git commit -m x',
      'git branch -D old',
      'git checkout -b new',
      'npm install',
      'find . -delete',
      'sed -i s/a/b/ x',
      'env X=1 node build.js',
      '/usr/bin/env node build.js',
      'echo $(rm -rf /)',
      // From the review of #15: flags of programs that only look which write, or run another program.
      'git stash',
      'git stash push',
      'git reflog expire --expire=now --all',
      'git diff --output=/tmp/x',
      'git show --output=/tmp/x HEAD',
      "git -c core.fsmonitor='touch /tmp/x' status",
      'git --config-env=core.pager=X log',
      "git grep -O'touch /tmp/x' retry",
      'git diff --ext-diff',
      'git log -p --textconv',
      "rg --pre 'touch /tmp/x' retry",
      'rg --pre-glob "*.ts" retry',
      'fd . -x touch',
      'fd --exec-batch touch',
      'sort -o /tmp/x notes.txt',
      'sort --compress-program=touch notes.txt',
      'uniq in.txt out.txt',
      'tree -o /tmp/x',
      'find . -fprint0 /tmp/x',
      "sed -n 'w /tmp/x' notes.txt",
      "sed -n '1e touch x' notes.txt",
      'sed -f script.sed notes.txt',
      'file -C -m magic',
      'date -s 2020-01-01',
      'ag --pager "touch /tmp/x" retry',
      'rg --no-such-flag retry',
      'uniq -c -- in.txt out.txt',
    ].map((command) => {
      const decided = decideReader(request({ kind: 'execute', title: command, rawInput: { command } }))
      return decided.verdict === 'deny' ? decided.reason : ''
    })
    assert.isTrue(
      reasons.every((reason) => reason.endsWith('this role only reads.')),
      reasons.join('\n'),
    )
    assert.strictEqual(verdict({ kind: 'other', title: 'api.github.com' }), 'deny')
    assert.strictEqual(verdict({ kind: 'execute', title: '' }), 'deny')
  })

  it('never reads credentials either, and says so', () => {
    for (const command of ['security find-generic-password -s Althar -w', 'git credential fill', 'cat x | git-credential-store get']) {
      const decided = decideReader(request({ kind: 'execute', title: command, rawInput: { command } }))
      assert.include(decided.verdict === 'deny' ? decided.reason : '', "don't read the person's credentials", command)
    }
  })
})

describe('a project’s rules (ADR-013)', () => {
  const rules = (project: Partial<ProjectRuleSet>) => ({ project: { ...MVP_RULES, ...project } })
  const verdictOf = (command: string, project: Partial<ProjectRuleSet>) => run(command, rules(project))

  it('ask about the kinds on the always-ask list, let the rest through, and refuse what is never allowed', () => {
    assert.strictEqual(verdictOf('git push --force origin althar/retry', {}).verdict, 'ask')
    assert.strictEqual(verdictOf('git push --force origin althar/retry', { ask: ['deploy'] }).verdict, 'allow')
    assert.deepStrictEqual(verdictOf('git push --force origin althar/retry', { never: ['force-push'] }), {
      verdict: 'deny',
      reason: "The project's rules never allow force pushes.",
    })
    assert.deepStrictEqual(verdictOf('npx vercel deploy --prod', { ask: [], never: ['deploy'] }), {
      verdict: 'deny',
      reason: "The project's rules never allow deploying and publishing.",
    })
    // What the rules can't tell asks, even with the list off.
    assert.strictEqual(verdictOf('git push --weird origin', { ask: [] }).verdict, 'ask')
  })

  it('allow everything, short of what is never allowed and what no project can change', () => {
    const allow = { mode: 'allow' as const, never: ['deploy' as const], commands: [{ pattern: 'rm -rf /', decision: 'never' as const }] }
    assert.strictEqual(verdictOf('git push --force origin main', allow).verdict, 'allow')
    // What the rules can't read is refused, with how to spell it out, while something is never allowed; let through when nothing is.
    assert.strictEqual(verdictOf('git push --weird origin', allow).verdict, 'deny')
    assert.strictEqual(verdictOf('git push --weird origin', { mode: 'allow' }).verdict, 'allow')
    assert.strictEqual(verdictOf('vercel deploy', allow).verdict, 'deny')
    assert.strictEqual(verdictOf('rm -rf / --no-preserve-root', allow).verdict, 'deny')
    assert.strictEqual(verdictOf('gh pr create', allow).verdict, 'deny')
    assert.strictEqual(verdictOf('security find-generic-password -s Althar -w', allow).verdict, 'deny')
  })

  it('ask about everything beyond the sandbox where the project says so, short of reads', () => {
    assert.deepStrictEqual(verdictOf('npm test', { mode: 'ask' }), {
      verdict: 'ask',
      reason: "This project asks you before anything an agent does beyond the task's own files.",
    })
    assert.strictEqual(
      decide(request({ kind: 'read', title: 'Read README.md' }), { ...context, ...rules({ mode: 'ask' }) }).verdict,
      'allow',
    )
    assert.strictEqual(verdictOf('npm test', {}).verdict, 'allow')
  })

  it('ask about or refuse the commands it names, each command in a line read on its own', () => {
    const commands = [
      { pattern: 'terraform *', decision: 'ask' as const },
      { pattern: 'npm publish', decision: 'never' as const },
      { pattern: 'npm', decision: 'ask' as const },
    ]
    assert.deepStrictEqual(verdictOf('cd infra && terraform plan -out plan.tfplan', { commands }), {
      verdict: 'ask',
      reason: "The project's rules ask before `terraform *`.",
    })
    // A kind on the always-ask list says its own reason first.
    assert.deepStrictEqual(verdictOf('terraform apply', { commands }), { verdict: 'ask', reason: 'Deploying or publishing always asks.' })
    // A refusal wins over an ask that also matches.
    assert.deepStrictEqual(verdictOf('FOO=1 /usr/local/bin/npm publish --tag next', { commands }), {
      verdict: 'deny',
      reason: "The project's rules never allow `npm publish`.",
    })
    assert.strictEqual(verdictOf('npm test', { commands }).verdict, 'ask')
    assert.strictEqual(verdictOf('npm run build', { commands: commands.slice(0, 2) }).verdict, 'allow')
    // A line whose commands show only when it runs meets a pattern whose program it names.
    assert.strictEqual(verdictOf('eval "$(echo terraform) plan"', { commands: commands.slice(0, 1) }).verdict, 'ask')
  })

  it('match a pattern by how a command starts, its program by name, `*` for anything', () => {
    assert.isTrue(matchesPattern('npm publish', ['/usr/local/bin/npm', 'publish', '--tag', 'next']))
    assert.isFalse(matchesPattern('npm publish', ['npm', 'publisher']))
    assert.isTrue(matchesPattern(' terraform  * ', ['terraform', 'apply']))
    assert.isTrue(matchesPattern('git push * --force', ['git', 'push', 'origin', '--force']))
    assert.isFalse(matchesPattern('a.b', ['axb']))
    assert.isFalse(matchesPattern('kubectl apply', ['kubectl', 'get', 'pods']))
  })
})

describe('a project’s rules, as the coordinator is told them', () => {
  it('says what waits for the person and what is never allowed, by the mode', () => {
    assert.strictEqual(
      sayRules(MVP_RULES),
      "Agents may do anything but these, which wait for the person: pushing to the default branch; force pushes; pushing every branch, tags, or a pattern of branches; deleting branches that aren't the task's; deploying and publishing; writing outside the task's worktree.",
    )
    assert.strictEqual(
      sayRules({ mode: 'rules', ask: [], never: ['deploy'], commands: [{ pattern: 'terraform *', decision: 'never' }] }),
      'Agents may do anything. Never allowed: deploying and publishing; commands starting `terraform *`.',
    )
    assert.strictEqual(
      sayRules({ mode: 'ask', ask: RULES, never: [], commands: [] }),
      "Agents may read anything and change a task's own files; everything else waits for the person.",
    )
    assert.strictEqual(
      sayRules({ mode: 'allow', ask: RULES, never: [], commands: [{ pattern: 'npm publish', decision: 'ask' }] }),
      'Agents may do anything.',
    )
    assert.strictEqual(
      sayRules({ mode: 'rules', ask: ['force-push'], never: [], commands: [{ pattern: 'npm publish', decision: 'ask' }] }),
      'Agents may do anything but these, which wait for the person: force pushes; commands starting `npm publish`.',
    )
  })
})

describe('a project’s rules, after review of #24', () => {
  const rules = (project: Partial<ProjectRuleSet>) => ({ project: { ...MVP_RULES, ...project } })
  const verdictOf = (command: string, project: Partial<ProjectRuleSet>) => run(command, rules(project)).verdict

  it('refuse a request for any kind it is that is never allowed, not only the first one noticed', () => {
    const neverMain = { never: ['default-branch' as const], ask: RULES.filter((kind) => kind !== 'force-push') }
    for (const command of [
      'git push --force origin main',
      'git push origin +HEAD:main',
      'git push --force origin althar/retry && git push origin main',
    ])
      assert.strictEqual(verdictOf(command, neverMain), 'deny', command)
    for (const command of ['git push -f origin main', 'npm publish && git push origin main'])
      assert.strictEqual(verdictOf(command, { never: ['default-branch'] }), 'deny', command)
  })

  it('count deploying only where a command’s program or subcommand says so', () => {
    const never = { never: ['deploy' as const] }
    for (const command of [
      'cat docs/deploy.md',
      'grep -rn deploy src',
      'git commit -m "Fix the deploy script"',
      'ls scripts/deploy',
      'npm test -- deploy.test.ts',
    ])
      assert.strictEqual(verdictOf(command, never), 'allow', command)
    for (const command of [
      './scripts/deploy.sh staging',
      'make deploy-prod',
      'npm run deploy:staging',
      'npx vercel deploy --prod',
      'fly deploy',
      'twine upload dist/*',
      'bash ops/run.sh deploy prod',
    ])
      assert.strictEqual(verdictOf(command, never), 'deny', command)
  })

  it('refuse with everything allowed what the rules can’t read, while something is never allowed', () => {
    const allow = { mode: 'allow' as const, never: ['default-branch' as const, 'deploy' as const] }
    assert.strictEqual(verdictOf('git push origin main', allow), 'deny')
    for (const command of ['eval "git push origin main"', 'git push origin $(echo main)', 'eval "npm publish"'])
      assert.strictEqual(verdictOf(command, allow), 'deny', command)
    assert.include(
      run('eval "npm publish"', rules(allow)).verdict === 'deny'
        ? (run('eval "npm publish"', rules(allow)) as { reason: string }).reason
        : '',
      'without `eval` or `$(…)`',
    )
  })

  it('let the task’s own files be changed when the project asks about everything, as every agent’s sandbox would', () => {
    const askAll = rules({ mode: 'ask' })
    const edit = (path: string) =>
      decide(request({ kind: 'edit', title: `Edit ${path}`, paths: [path] }), { ...context, ...askAll }).verdict
    assert.strictEqual(edit(`${worktree}/src/app.ts`), 'allow')
    assert.strictEqual(edit('/etc/hosts'), 'ask')
    // Outside the worktree it still asks, with writing outside off the always-ask list.
    const outsideOff = rules({ mode: 'ask', ask: RULES.filter((kind) => kind !== 'outside') })
    assert.strictEqual(
      decide(request({ kind: 'edit', title: 'Edit /etc/hosts', paths: ['/etc/hosts'] }), { ...context, ...outsideOff }).verdict,
      'ask',
    )
    assert.strictEqual(verdictOf('npm test', { mode: 'ask' }), 'ask')
  })

  it('match a command rule on an unreadable line by the program as a word of its own', () => {
    assert.strictEqual(verdictOf('echo $(date) && pnpm install', { commands: [{ pattern: 'npm run *', decision: 'never' }] }), 'allow')
    assert.strictEqual(
      verdictOf('npm run format -- $(git ls-files "*.ts")', { commands: [{ pattern: 'rm *', decision: 'never' }] }),
      'allow',
    )
    assert.strictEqual(verdictOf('echo $(rm -rf build)', { commands: [{ pattern: 'rm *', decision: 'never' }] }), 'deny')
  })

  it('see through `timeout` and package runners', () => {
    const commands = [
      { pattern: 'psql *', decision: 'never' as const },
      { pattern: 'prisma migrate reset', decision: 'never' as const },
    ]
    for (const command of [
      "timeout 60 psql -c 'drop table users'",
      'timeout -s KILL 5m psql',
      'npx prisma migrate reset',
      'npx -y prisma migrate reset --force',
      'pnpm exec prisma migrate reset',
      'bunx prisma migrate reset',
    ])
      assert.strictEqual(verdictOf(command, { commands }), 'deny', command)
    assert.strictEqual(verdictOf('npx prisma generate', { commands }), 'allow')
  })
})

describe('a task of several repositories', () => {
  // Its lead starts in the folder that holds its worktrees; it may write in any of them.
  const folder = '/work/meridian/retry'
  const several: RuleContext = {
    ...context,
    worktree: folder,
    worktrees: [`${folder}/api`, `${folder}/web`],
    defaultBranch: 'main',
    defaultBranches: ['main', 'develop'],
  }
  const edit = (path: string) => decide(request({ kind: 'edit', title: `Edit ${path}`, paths: [path] }), several).verdict

  it('lets it write in each of its worktrees, and asks about the folder that holds them', () => {
    assert.strictEqual(edit(`${folder}/api/src/retry.ts`), 'allow')
    assert.strictEqual(edit(`${folder}/web/src/retry.tsx`), 'allow')
    assert.strictEqual(edit(`${folder}/notes.md`), 'ask')
    assert.strictEqual(decide(request({ title: 'cd web && git commit -am retry' }), several).verdict, 'allow')
  })

  it('asks before a push to any of their default branches', () => {
    assert.strictEqual(decide(request({ title: 'git -C web push origin develop' }), several).verdict, 'ask')
    assert.strictEqual(decide(request({ title: 'git -C api push origin main' }), several).verdict, 'ask')
    assert.strictEqual(
      decide(request({ title: 'git -C api push origin althar/retry' }), { ...several, taskBranch: 'althar/retry' }).verdict,
      'allow',
    )
  })
})
