import type { ProjectId } from '@charrette/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Policies, type ProjectRules, ruleSetOf } from '../src/Policies'
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
    assert.deepStrictEqual(ruleSetOf(mvp), { mode: 'rules', ask: RULES, never: [], commands: [] })
    assert.deepStrictEqual(
      ruleSetOf({
        source: 'person',
        permissions: 'ask',
        alwaysAsk: ['deploy', 'outside'],
        never: ['force-push', 'nonsense'],
        commands: [{ pattern: 'npm publish', decision: 'never' }],
      }),
      { mode: 'ask', ask: ['deploy', 'outside'], never: ['force-push'], commands: [{ pattern: 'npm publish', decision: 'never' }] },
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
})
