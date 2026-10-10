import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Policies, type ProjectRules, ruleSetOf, withRemembered } from '../src/Policies'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { RULES } from '../src/rules'
import { repository, runtime } from './support'

/*
 * A project's rules (ADR-013): revisions the person makes, read by the
 * rules as a rule set. What the MVP wrote in words reads as it did then.
 */

describe('a project’s rules, as kept', () => {
  it('read as a rule set: the MVP’s words as every kind, ids as named, and nothing allowed that isn’t a kind', () => {
    const mvp: ProjectRules = {
      source: 'mvp',
      alwaysAsk: ['push to the default branch', 'force push', 'merge', 'deploy', 'write outside the worktree'],
    }
    assert.deepStrictEqual(ruleSetOf(mvp), { mode: 'rules', ask: RULES, never: [], allow: [], commands: [] })
    assert.deepStrictEqual(
      ruleSetOf({
        source: 'person',
        permissions: 'ask',
        alwaysAsk: ['deploy', 'outside'],
        never: ['force-push', 'nonsense'],
        commands: [{ pattern: 'npm publish', decision: 'never' }],
      }),
      {
        mode: 'ask',
        ask: ['deploy', 'outside'],
        never: ['force-push'],
        allow: [],
        commands: [{ pattern: 'npm publish', decision: 'never' }],
      },
    )
  })

  it.effect('make a project’s first revision once, however many read it at the same moment', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      const read = yield* Effect.all(
        Array.from({ length: 5 }, () => policies.current(projectId)),
        { concurrency: 'unbounded' },
      )
      assert.lengthOf(new Set(read.map((policy) => policy.id)), 1)
      assert.lengthOf(yield* sql`SELECT id FROM policies WHERE project_id = ${projectId}`, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('keep both of two changes made at the same moment', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      yield* policies.current(projectId)
      yield* Effect.all(
        [
          policies.set(projectId, { permissions: 'ask' }, instance.personId),
          policies.set(projectId, { never: ['deploy'] }, instance.personId),
          policies.set(projectId, { end: 'none' }, instance.personId),
        ],
        { concurrency: 'unbounded' },
      )
      const { rules } = yield* policies.current(projectId)
      assert.deepStrictEqual([rules.permissions, rules.never, rules.end], ['ask', ['deploy'], 'none'])
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('change by revisions recorded as the person’s, none where nothing changes, commands tidied and an ending cleared', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      const set = yield* policies.set(
        projectId,
        {
          permissions: 'ask',
          never: ['deploy'],
          commands: [
            { pattern: '  terraform   * ', decision: 'ask' },
            { pattern: '   ', decision: 'never' },
          ],
          end: 'ready',
        },
        instance.personId,
      )
      assert.deepStrictEqual(set, {
        source: 'person',
        permissions: 'ask',
        alwaysAsk: [...RULES],
        never: ['deploy'],
        commands: [{ pattern: 'terraform *', decision: 'ask' }],
        end: 'ready',
      })
      // The same again makes no revision; clearing the ending does.
      yield* policies.set(projectId, { permissions: 'ask' }, instance.personId)
      const cleared = yield* policies.set(projectId, { end: null }, instance.personId)
      assert.isUndefined(cleared.end)
      assert.deepStrictEqual((yield* policies.current(projectId)).rules, cleared)
      const revisions = yield* sql<{ revision: number; actorId: string }>`
        SELECT revision, created_by_actor_id AS actor_id FROM policies WHERE project_id = ${projectId} ORDER BY revision`
      assert.deepStrictEqual(
        revisions.map((row) => [row.revision, row.actorId === instance.personId]),
        [
          [1, false],
          [2, true],
          [3, true],
        ],
      )
      const refused = yield* Effect.flip(policies.set('proj_missing', { permissions: 'allow' }, instance.personId))
      assert.strictEqual(refused._tag, 'NotFound')
    }).pipe(Effect.provide(runtime())),
  )

  it('keep a rule an always answer saves: a never in place of an allow, an allow only where nothing is kept, a kind on its list', () => {
    const first: ProjectRules = { source: 'person', alwaysAsk: [], commands: [{ pattern: 'git status', decision: 'ask' }] }
    // An allow doesn't loosen what the person keeps for themselves.
    assert.strictEqual(withRemembered(first, { decision: 'allow', pattern: 'git status', match: 'prefix' }), first)
    const allowed = withRemembered({ ...first, commands: [] }, { decision: 'allow', pattern: 'git status', match: 'prefix' })
    assert.deepStrictEqual(allowed.commands, [{ pattern: 'git status', decision: 'allow' }])
    // The same rule again changes nothing; a never takes an allow's place; the same words exactly are another rule.
    assert.strictEqual(withRemembered(allowed, { decision: 'allow', pattern: 'git status', match: 'prefix' }), allowed)
    assert.deepStrictEqual(withRemembered(allowed, { decision: 'never', pattern: 'git status', match: 'prefix' }).commands, [
      { pattern: 'git status', decision: 'never' },
    ])
    assert.deepStrictEqual(withRemembered(allowed, { decision: 'never', pattern: 'git status', match: 'exact' }).commands, [
      { pattern: 'git status', decision: 'allow' },
      { pattern: 'git status', decision: 'never', match: 'exact' },
    ])
    const kinds = withRemembered(withRemembered(first, { decision: 'allow', kind: 'deploy' }), { decision: 'allow', kind: 'deploy' })
    assert.deepStrictEqual(kinds.alwaysAllow, ['deploy'])
    const refused = withRemembered(kinds, { decision: 'never', kind: 'deploy' })
    assert.deepStrictEqual([refused.never, refused.alwaysAllow], [['deploy'], []])
    assert.strictEqual(withRemembered(refused, { decision: 'never', kind: 'deploy' }).never, refused.never)
    assert.deepStrictEqual(ruleSetOf({ ...kinds, alwaysAllow: ['deploy', 'nonsense'] }).allow, ['deploy'])
  })

  it.effect('remember a rule as a revision recorded as whoever answered, and none where it holds already', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      yield* policies.remember(projectId, { decision: 'allow', pattern: 'git status', match: 'prefix' }, instance.personId)
      yield* policies.remember(projectId, { decision: 'allow', pattern: 'git status', match: 'prefix' }, instance.personId)
      const { rules } = yield* policies.current(projectId)
      assert.deepStrictEqual([rules.source, rules.commands], ['person', [{ pattern: 'git status', decision: 'allow' }]])
      assert.lengthOf(yield* sql`SELECT id FROM policies WHERE project_id = ${projectId}`, 2)
      const refused = yield* Effect.flip(policies.remember('proj_missing', { decision: 'never', kind: 'deploy' }, instance.personId))
      assert.strictEqual(refused._tag, 'NotFound')
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('tidy command rules as they are set: one by how it starts by its words, an exact one as it was', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const set = yield* policies.set(
        project.projectId,
        {
          alwaysAllow: ['deploy'],
          commands: [
            { pattern: '  bun   test ', decision: 'allow' },
            { pattern: ' echo "a  b" ', decision: 'allow', match: 'exact' },
            { pattern: '  ', decision: 'allow', match: 'exact' },
          ],
        },
        instance.personId,
      )
      assert.deepStrictEqual(set.commands, [
        { pattern: 'bun test', decision: 'allow' },
        { pattern: 'echo "a  b"', decision: 'allow', match: 'exact' },
      ])
      assert.deepStrictEqual(set.alwaysAllow, ['deploy'])
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('refuse an allow for words the rules ask about or never allow, as a card would', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* policies.set(project.projectId, { commands: [{ pattern: 'bun test', decision: 'never' }] }, instance.personId)
      // In place of the never, or beside it: the never stays.
      for (const commands of [
        [{ pattern: 'bun test', decision: 'allow' as const }],
        [
          { pattern: 'bun test', decision: 'never' as const },
          { pattern: 'bun test', decision: 'allow' as const },
        ],
      ]) {
        const refused = yield* Effect.flip(policies.set(project.projectId, { commands }, instance.personId))
        assert.deepStrictEqual([refused._tag, refused._tag === 'RuleOnAnotherList' ? refused.list : null], ['RuleOnAnotherList', 'never'])
      }
      assert.deepStrictEqual((yield* policies.current(project.projectId as ProjectId)).rules.commands, [
        { pattern: 'bun test', decision: 'never' },
      ])
      // The same words exactly are another rule.
      const exact = yield* policies.set(
        project.projectId,
        {
          commands: [
            { pattern: 'bun test', decision: 'never' },
            { pattern: 'bun test', decision: 'allow', match: 'exact' },
          ],
        },
        instance.personId,
      )
      assert.lengthOf(exact.commands ?? [], 2)
      const asked = yield* Effect.flip(
        policies.set(
          project.projectId,
          {
            commands: [
              { pattern: 'npm test', decision: 'ask' },
              { pattern: 'npm  test', decision: 'allow' },
            ],
          },
          instance.personId,
        ),
      )
      assert.strictEqual(asked._tag === 'RuleOnAnotherList' ? asked.list : null, 'ask')
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('refuse a change made against rules that have moved on since, and keep what moved them', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      const seen = yield* policies.current(projectId)
      // A card keeps a rule while the rules screen still shows what it read.
      yield* policies.remember(projectId, { decision: 'allow', pattern: 'git status', match: 'prefix' }, instance.personId)
      const refused = yield* Effect.flip(policies.set(projectId, { commands: [] }, instance.personId, seen.revision))
      assert.deepStrictEqual(
        [refused._tag, refused._tag === 'RulesChanged' ? [refused.expected, refused.revision] : null],
        ['RulesChanged', [seen.revision, seen.revision + 1]],
      )
      assert.deepStrictEqual((yield* policies.current(projectId)).rules.commands, [{ pattern: 'git status', decision: 'allow' }])
      // Against the rules as they are, it goes through.
      yield* policies.set(projectId, { commands: [] }, instance.personId, seen.revision + 1)
      assert.deepStrictEqual((yield* policies.current(projectId)).rules.commands, [])
    }).pipe(Effect.provide(runtime())),
  )
})
