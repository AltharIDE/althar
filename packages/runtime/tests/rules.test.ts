import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PermissionRequest } from '@charrette/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import { commandOf, decide, essentials, parseCommandLine, pathsOf, type RuleContext } from '../src/rules'

const worktree = '/work/meridian/retry/app'
const context: RuleContext = { worktree, defaultBranch: 'main', taskBranch: 'charrette/retry', currentBranch: 'charrette/retry' }

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
    'git push origin charrette/retry',
    'git push origin HEAD:refs/heads/charrette/retry',
    'git push origin charrette/main-fix',
    'git push origin --delete charrette/retry',
    `git -C ${worktree} push origin charrette/retry`,
    'git merge main',
    'npm run build 2>&1 | tee build.log',
    'rm -rf node_modules dist',
    'mkdir -p src/lib && cp README.md src/lib/',
    'echo done > /tmp/charrette-note',
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
    ['git push -uf origin charrette/retry', 'A force push always asks.'],
    ['git push --force-with-lease', 'A force push always asks.'],
    ['git push origin +charrette/retry', 'A force push always asks.'],
    ['git push --tags', 'Pushing tags always asks; they often start a release.'],
    ['git push origin v1.2.0:refs/tags/v1.2.0', 'Pushing tags always asks; they often start a release.'],
    ['git push --prune origin', 'A push that deletes remote branches always asks.'],
    ['git push origin "refs/heads/*"', 'A push to a pattern of branches always asks.'],
    ['git push origin :', 'A push of matching branches always asks.'],
    ['git push origin HEAD:refs/notes/x', "Charrette can't tell what `refs/notes/x` is, so it asks."],
    ['git push --weird origin', "Charrette can't tell what `--weird` does to a push, so it asks."],
    ['git push origin $(git branch --show-current)', "Charrette can't tell what this command does until it runs, so it asks."],
    ['gh pr merge 12 --squash', 'A merge always asks.'],
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
    ['touch ~/charrette-probe.txt', "Writing outside the task's worktree always asks:"],
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
    ['git --git-dir /elsewhere/.git status', 'ask'],
    ['git --work-tree=/elsewhere status', 'ask'],
    ['git push --repo origin -o ci.skip origin charrette/retry', 'allow'],
    ['git push --push-option=ci.skip origin charrette/retry', 'allow'],
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
      reason: "Charrette can't tell where this edit writes, so it asks.",
    })
    assert.strictEqual(decide(request({ kind: 'delete' }), context).verdict, 'ask')
  })

  it('follows symlinks out of the worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'charrette-rules-'))
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
