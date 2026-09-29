import type { PermissionRequest } from '@charrette/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import { commandOf, decide, pathsOf } from '../src/rules'

const context = { worktree: '/work/meridian/retry/app', defaultBranch: 'main' }

const request = (fields: Partial<PermissionRequest>): PermissionRequest => ({
  sessionId: 's',
  toolCallId: 't',
  title: '',
  kind: 'execute',
  paths: [],
  options: [],
  ...fields,
})

const run = (command: string) => decide(request({ title: command }), context)

describe('the rules', () => {
  it.each([
    'bun test',
    'git status',
    'git push',
    'git push -u origin charrette/retry',
    'git push origin charrette/main-fix',
    'git merge main',
    'npm run build',
  ])('allows %s', (command) => {
    assert.deepStrictEqual(run(command), { verdict: 'allow' })
  })

  it.each([
    ['git push origin main', 'A push to main always asks.'],
    ['git push origin HEAD:main', 'A push to main always asks.'],
    ['git push --force', 'A force push always asks.'],
    ['git push -f origin charrette/retry', 'A force push always asks.'],
    ['git push --force-with-lease', 'A force push always asks.'],
    ['git push origin +charrette/retry', 'A force push always asks.'],
    ['gh pr merge 12 --squash', 'A merge always asks.'],
    ['make deploy', 'Deploying or publishing always asks.'],
    ['npx wrangler deploy', 'Deploying or publishing always asks.'],
    ['vercel --prod', 'Deploying or publishing always asks.'],
    ['kubectl apply -f prod.yaml', 'Deploying or publishing always asks.'],
    ['terraform apply', 'Deploying or publishing always asks.'],
    ['npm publish', 'Deploying or publishing always asks.'],
  ])('asks about %s', (command, reason) => {
    assert.deepStrictEqual(run(command), { verdict: 'ask', reason })
  })

  it('checks the default branch the project has', () => {
    assert.strictEqual(decide(request({ title: 'git push origin trunk' }), { ...context, defaultBranch: 'trunk' }).verdict, 'ask')
    assert.strictEqual(decide(request({ title: 'git push origin main' }), { ...context, defaultBranch: 'trunk' }).verdict, 'allow')
  })

  it('reads the command from the raw input when the agent gives one', () => {
    assert.strictEqual(commandOf(request({ title: 'Run a command', rawInput: { command: 'git push --force' } })), 'git push --force')
    assert.strictEqual(
      commandOf(request({ title: 'Run a command', rawInput: { command: ['bash', '-lc', 'make deploy'] } })),
      'bash -lc make deploy',
    )
    assert.strictEqual(commandOf(request({ title: 'git status', rawInput: { command: 42 } })), 'git status')
    assert.strictEqual(decide(request({ kind: 'other', title: 'Terminal', rawInput: { cmd: 'npm publish' } }), context).verdict, 'ask')
  })

  it('asks about writes outside the worktree, and allows them inside', () => {
    const edit = (fields: Partial<PermissionRequest>) => decide(request({ kind: 'edit', title: 'Edit', ...fields }), context)
    assert.deepStrictEqual(edit({ paths: ['src/app.ts'] }), { verdict: 'allow' })
    assert.deepStrictEqual(edit({ paths: ['/work/meridian/retry/app/src/app.ts'] }), { verdict: 'allow' })
    assert.deepStrictEqual(edit({ rawInput: { file_path: '/Users/someone/.zshrc' } }), {
      verdict: 'ask',
      reason: "Writing outside the task's worktree always asks: /Users/someone/.zshrc",
    })
    assert.strictEqual(edit({ paths: ['../other/file.ts'] }).verdict, 'ask')
    assert.strictEqual(decide(request({ kind: 'move', rawInput: { new_path: '/tmp/x' } }), context).verdict, 'ask')
    assert.strictEqual(decide(request({ kind: 'delete', paths: ['/work/meridian/retry/app'] }), context).verdict, 'allow')
    assert.strictEqual(decide(request({ kind: 'read', paths: ['/etc/hosts'] }), context).verdict, 'allow')
  })

  it('collects every path an action names, once', () => {
    assert.deepStrictEqual(
      pathsOf(request({ paths: ['a.ts'], rawInput: { path: 'a.ts', filePath: 'b.ts', old_path: '', other: 'c.ts' } })),
      ['a.ts', 'b.ts'],
    )
  })
})
