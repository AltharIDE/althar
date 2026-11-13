import { Ids, newId } from '@althar/domain'
import { assert, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { checksAppearing } from '../src/checksAppear'
import { Projects } from '../src/Projects'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

it.live('binds the checks-registration wait to a known CI repository and the exact pushed head, and never hides an unreadable result', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: opened.projectId,
      title: 'Register checks',
      draft: true,
    })
    const linkId = yield* newId(Ids.externalLink)
    const url = 'https://github.test/meridian/api/pull/1'
    const at = yield* timestamp
    yield* sql`INSERT INTO external_links ${sql.insert({ id: linkId, projectId: opened.projectId, taskId: task.taskId, product: 'github', kind: 'change', externalId: '1', ref: '#1', key: '#1', url, snapshot: JSON.stringify({ repository: ['meridian', 'api'] }), createdAt: at, updatedAt: at })}`
    const observation = (kind: string, payload: object, observedAt: string = at) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO observations ${sql.insert({ id: yield* newId(Ids.observation), projectId: opened.projectId, subjectType: 'external_link', subjectId: linkId, kind, payload: JSON.stringify(payload), source: 'althar', observedAt })}`
      })
    yield* observation('pushed', { id: 'pushed:one', sha: 'one' })
    assert.isFalse(yield* checksAppearing(task.taskId, url, 'one'))
    yield* observation('checks', { id: 'checks:old', sha: 'old', outcome: 'passed' })
    assert.isTrue(yield* checksAppearing(task.taskId, url, 'one'))
    assert.isFalse(yield* checksAppearing(task.taskId, url, 'other'))
    yield* observation('checks_unreadable', { id: 'unreadable:one', message: 'Permission denied' })
    assert.isFalse(yield* checksAppearing(task.taskId, url, 'one'))
    yield* observation('pushed', { id: 'pushed:two', sha: 'two' }, '2000-01-01T00:00:00.000Z')
    assert.isFalse(yield* checksAppearing(task.taskId, url, 'two'))
    // A later duplicate observation cannot restart an already expired wait for the same head.
    yield* observation('pushed', { id: 'pushed:two:again', sha: 'two' })
    assert.isFalse(yield* checksAppearing(task.taskId, url, 'two'))
  }).pipe(Effect.provide(runtime(':memory:', {}, { checksAppear: Duration.minutes(1) }))),
)
