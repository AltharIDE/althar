import type { AutomationDefinition } from '@althar/contracts'
import type { PermissionRequest } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Option } from 'effect'

import { definitionOf, partsOf, runRules } from '../src/automated'
import { briefOf, titleOf, widens } from '../src/Automations'
import { orderIn } from '../src/Busy'
import { bodyOf, nameInLine, signed } from '../src/pullRequestWords'
import { decide, MVP_RULES, type ProjectRuleSet } from '../src/rules'

/*
 * What an automation's run is told and how it is signed, the rules it runs
 * by, and where its work waits: the pieces that need no runtime.
 */

const NIGHTLY: AutomationDefinition = {
  name: 'Nightly dependency bump',
  prompt: 'Bump the dependencies and open a pull request if the tests pass.',
  schedule: { every: 'week', days: [1, 2, 3, 4, 5, 6, 7], at: '02:00' },
  zone: 'Europe/London',
  lead: { agentId: 'claude-code', model: 'opus', effort: 'high' },
  work: { kind: 'task', review: { agentId: 'codex', model: null }, end: 'draft' },
  allowEverything: true,
  minutes: 45,
  late: 'once',
}

const LONDON = 'Europe/London'

describe('an automation’s words', () => {
  it('titles each run’s task with its name and its day, cut at a word', () => {
    const at = Date.parse('2026-10-23T15:00:00Z')
    assert.strictEqual(titleOf('Release notes', at, LONDON), 'Release notes, 23 Oct')
    const long = titleOf('Every Friday, write the release notes from what merged this week, and post them', at, LONDON)
    assert.isAtMost(long.length, 60)
    assert.match(long, /…, 23 Oct$/)
  })

  it('tells the lead whose run it is, when it was due, and what it may do', () => {
    const due = Date.parse('2026-10-21T01:00:00Z')
    const brief = briefOf(NIGHTLY, due, due + 60_000, LONDON)
    assert.include(brief, NIGHTLY.prompt)
    assert.include(brief, 'This is a run of the automation “Nightly dependency bump”, which runs every day at 2:00')
    assert.include(brief, 'It was due at 2:00.')
    assert.include(brief, 'allows everything but pushing to the default branch')
    // Late, it says when it is.
    const late = briefOf(NIGHTLY, due, due + 7 * 3_600_000, LONDON)
    assert.include(late, 'It was due at 2:00; it is 9:00, since the Mac was asleep or Althar was closed.')
    // Its asks wait for the person where it doesn't allow everything.
    assert.include(briefOf({ ...NIGHTLY, allowEverything: false }, due, due, LONDON), 'what you ask waits for the person')
  })

  it('needs the person to turn it on again for a change that reaches further, not for a shorter time', () => {
    assert.isFalse(widens(NIGHTLY, { ...NIGHTLY, minutes: 30 }))
    assert.isTrue(widens(NIGHTLY, { ...NIGHTLY, minutes: 60 }))
    assert.isTrue(widens(NIGHTLY, { ...NIGHTLY, prompt: 'Bump everything, and merge it.' }))
    assert.isTrue(widens(NIGHTLY, { ...NIGHTLY, work: { kind: 'task', review: null, end: 'ready' } }))
    assert.isTrue(widens(NIGHTLY, { ...NIGHTLY, schedule: { every: 'hour', minute: 0 } }))
  })

  it('keeps a definition as its name, its prompt and its parts', () => {
    const row = { name: NIGHTLY.name, prompt: NIGHTLY.prompt, parts: partsOf(NIGHTLY) }
    assert.deepStrictEqual(Option.getOrNull(definitionOf(row)), NIGHTLY)
    assert.notInclude(row.parts, NIGHTLY.prompt)
    assert.isTrue(Option.isNone(definitionOf({ ...row, parts: '{"schedule":{}}' })))
  })
})

describe('an automation’s signature', () => {
  it('signs a review with the automation’s name and the agent that wrote it', () => {
    assert.strictEqual(
      signed('Looks fine.', 'Claude Code', 'Morning review'),
      'Looks fine.\n\n<sub>From Althar’s morning review, by Claude Code.</sub>',
    )
    assert.strictEqual(signed('Looks fine.', 'Claude Code'), 'Looks fine.\n\n<sub>From Althar, by Claude Code.</sub>')
    assert.strictEqual(nameInLine('PR sweep'), 'PR sweep')
  })

  it('signs a pull request it opens, whatever the credit', () => {
    const body = (automation: string | null, credit: boolean) => bodyOf({ lead: 'Bumped.', issue: null, credit, automation })
    assert.include(body('Nightly bump', false), '<sub>Opened by [Althar](https://github.com/AltharIDE/althar)’s nightly bump.</sub>')
    assert.notInclude(body(null, false), 'Opened by')
    assert.include(body(null, true), '<sub>Opened by [Althar](https://github.com/AltharIDE/althar).</sub>')
  })
})

describe('an automation’s run', () => {
  const request = (command: string): PermissionRequest => ({
    sessionId: 's',
    toolCallId: 't',
    title: command,
    kind: 'execute',
    paths: [],
    options: [],
  })
  const context = (project: ProjectRuleSet) => ({
    worktree: '/work/meridian/bump/app',
    defaultBranch: 'main',
    taskBranch: 'althar/bump',
    currentBranch: 'althar/bump',
    project,
  })

  it('allows everything where its automation says, but never a push to the default branch', () => {
    const rules = runRules(MVP_RULES, true)
    assert.strictEqual(rules.mode, 'allow')
    assert.strictEqual(decide(request('npm install left-pad@latest'), context(rules)).verdict, 'allow')
    assert.strictEqual(decide(request('git push origin althar/bump'), context(rules)).verdict, 'allow')
    assert.strictEqual(decide(request('git push origin main'), context(rules)).verdict, 'deny')
    assert.strictEqual(decide(request('git push origin HEAD:main'), context(rules)).verdict, 'deny')
  })

  it('keeps the project’s rules where it doesn’t allow everything, the default branch still never', () => {
    const rules = runRules({ ...MVP_RULES, never: ['default-branch', 'deploy'] }, false)
    assert.strictEqual(rules.mode, MVP_RULES.mode)
    assert.deepStrictEqual(rules.never, ['default-branch', 'deploy'])
    assert.strictEqual(decide(request('git push origin main'), context(rules)).verdict, 'deny')
  })

  it('waits after everything else, unless the person did it', () => {
    const automated = new Set(['task_a'])
    assert.strictEqual(orderIn('new', 'task_a', automated), 'automation')
    assert.strictEqual(orderIn('underway', 'task_a', automated), 'automation')
    assert.strictEqual(orderIn('person', 'task_a', automated), 'person')
    assert.strictEqual(orderIn('new', 'task_b', automated), 'new')
  })
})
