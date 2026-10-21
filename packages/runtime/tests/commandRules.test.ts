import type { PermissionRequest } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import {
  alwaysOf,
  decide,
  decideReader,
  holds,
  MVP_RULES,
  programOf,
  type ProjectRuleSet,
  type RuleContext,
  sayAllowRule,
  shortCommand,
} from '../src/rules'

/*
 * The rules for agents' requests (ADR-013, ADR-018) at their edges: lines
 * that run nothing, package runners in their other forms, commands cut off
 * before their arguments, places the file system can't say, and what an
 * always would keep where the project has no rules of its own.
 */

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
const read = (command: string) => decideReader(request({ title: command }))

describe('lines that run nothing', () => {
  it('lets a line that only sets a variable, or only names a wrapper, through, as it runs no program', () => {
    for (const line of ['FOO=1', 'timeout', 'npx', 'git -C', 'git --git-dir']) assert.deepStrictEqual(run(line), { verdict: 'allow' }, line)
    // A shell's script, and a redirect after it with nowhere to write.
    assert.deepStrictEqual(run("sh -c 'ls' >"), { verdict: 'allow' })
  })

  it('lets a reader throw output away, and refuses one that writes it to a file', () => {
    assert.deepStrictEqual(read('> /dev/null'), { verdict: 'allow' })
    assert.deepStrictEqual(read('> notes.txt'), { verdict: 'deny', reason: 'It would write to notes.txt, and this role only reads.' })
  })
})

describe('a wrapper with nothing after it, where the project asks about everything', () => {
  const project: ProjectRuleSet = { mode: 'ask', ask: [], never: [], allow: [], commands: [{ pattern: 'npm test', decision: 'allow' }] }

  it('asks, as no rule covers it, and offers no rule by how it starts, as it starts as nothing', () => {
    assert.deepStrictEqual(run('timeout', { project }), {
      verdict: 'ask',
      reason: "This project asks you before anything an agent does beyond the task's own files.",
      held: false,
    })
    assert.deepInclude(alwaysOf(request({ title: 'timeout' }), { ...context, project }), { command: 'timeout', prefix: null, kind: null })
  })

  it('sees through `sudo` and its options to what it runs', () => {
    assert.deepStrictEqual(run('sudo -E npm publish'), { verdict: 'ask', reason: 'Deploying or publishing always asks.', held: true })
  })
})

describe('a code host, without a subcommand', () => {
  it('refuses `gh pr` alone as it would any change to the pull request, with how to reach it instead', () => {
    const said = run('gh pr')
    assert.strictEqual(said.verdict, 'deny')
    assert.include(said.verdict === 'deny' ? said.reason : '', 'push_to_pull_request')
  })
})

describe('package runners in their other forms', () => {
  it('see the deploy a runner runs, with its options, after `--`, or by another runner’s words', () => {
    for (const line of [
      'yarn dlx vercel deploy',
      'yarn exec vercel deploy',
      'npx -p vercel vercel deploy',
      'npx --package=vercel vercel deploy',
      'npx -- vercel deploy',
      'npx gh release create v1.2.0',
    ])
      assert.deepStrictEqual(run(line), { verdict: 'ask', reason: 'Deploying or publishing always asks.', held: true }, line)
    // A runner running something else is that, and nothing more.
    assert.deepStrictEqual(run('yarn dlx prettier --check .'), { verdict: 'allow' })
    // `timeout` with an option of its own that takes no value, before how long.
    assert.deepStrictEqual(run('timeout --preserve-status 600 npm publish'), {
      verdict: 'ask',
      reason: 'Deploying or publishing always asks.',
      held: true,
    })
  })
})

describe('what a command runs, by name', () => {
  it('names its program and subcommand, past a change of folder and variables, never its arguments', () => {
    assert.strictEqual(programOf('cd web && vercel deploy --prod --token s3cret'), 'vercel deploy')
    assert.strictEqual(programOf('FOO=1 /usr/bin/git status'), 'git status')
    // A subcommand only where the next word reads as one.
    assert.strictEqual(programOf('node ./scripts/build.js'), 'node')
    assert.strictEqual(programOf('ls'), 'ls')
  })

  it('names nothing for a line that runs no program', () => {
    for (const line of ['FOO=1', 'cd web', '> out.log', '']) assert.isUndefined(programOf(line), line)
  })
})

describe('how a command reads at a glance, at its edges', () => {
  it('keeps an empty word, quoted, so the line still reads as it runs', () => {
    assert.strictEqual(shortCommand("git commit --allow-empty -m ''"), "git commit --allow-empty -m ''")
  })

  it('shows a line that changes folder and only sets a variable as it was written', () => {
    assert.strictEqual(shortCommand('cd web && FOO=1'), 'cd web && FOO=1')
  })
})

describe('places the file system can’t say', () => {
  // Nothing on the way to the path can be read: the rules take it as written.
  const unreadable = { realPath: (): string => assert.fail('No folder can be read') }

  it('takes a path as written, letting the worktree’s own files be changed and asking about the rest', () => {
    const edit = (path: string) => decide(request({ kind: 'edit', paths: [path] }), { ...context, ...unreadable })
    assert.deepStrictEqual(edit(`${worktree}/src/retry.ts`), { verdict: 'allow' })
    assert.deepStrictEqual(edit('/etc/hosts'), {
      verdict: 'ask',
      reason: "Writing outside the task's worktree always asks: /etc/hosts",
      held: true,
    })
  })
})

describe('allow rules, beside a change of folder', () => {
  const project: ProjectRuleSet = {
    mode: 'ask',
    ask: [],
    never: [],
    allow: ['outside'],
    commands: [{ pattern: 'npm test', decision: 'allow' }],
  }

  it('let a change of folder that writes outside through by the kind it is, and the command by its rule', () => {
    assert.deepStrictEqual(run('cd . > /etc/where.txt && npm test', { project }), {
      verdict: 'allow',
      rules: [{ kind: 'outside' }, { pattern: 'npm test', match: 'prefix' }],
    })
    // Without the kind always allowed, the write outside waits for the person.
    assert.strictEqual(run('cd . > /etc/where.txt && npm test', { project: { ...project, allow: [] } }).verdict, 'ask')
  })

  it('say which allow rule let it through, as the person reads it', () => {
    assert.strictEqual(sayAllowRule({ kind: 'deploy' }), 'deploying and publishing')
    assert.strictEqual(sayAllowRule({ kind: 'outside' }), "writing outside the task's worktree")
    assert.strictEqual(sayAllowRule({ pattern: 'npm test', match: 'prefix' }), 'commands starting `npm test`')
    assert.strictEqual(sayAllowRule({ pattern: 'make check', match: 'exact' }), 'exactly `make check`')
  })
})

describe('an always, where the project has no rules of its own', () => {
  it('reads it under the rules every project starts with', () => {
    const push = request({ title: 'git push origin main' })
    assert.isTrue(holds(push, context, { decision: 'never', kind: 'default-branch' }))
    assert.isFalse(holds(push, context, { decision: 'allow', pattern: 'git push', match: 'prefix' }))
    assert.deepStrictEqual(alwaysOf(push, context), {
      command: 'git push origin main',
      prefix: 'git push',
      kind: 'default-branch',
      allow: [],
      deny: ['exact', 'prefix', 'kind'],
    })
    assert.deepStrictEqual(alwaysOf(push, context), alwaysOf(push, { ...context, project: MVP_RULES }))
  })

  it('offers no kind for an edit it can’t place, as no rule of a kind would hold for it', () => {
    assert.deepStrictEqual(alwaysOf(request({ kind: 'edit', title: 'Edit' }), context), {
      command: null,
      prefix: null,
      kind: null,
      allow: [],
      deny: [],
    })
  })
})
