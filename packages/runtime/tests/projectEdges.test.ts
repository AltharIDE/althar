import { execFileSync } from 'node:child_process'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound, ProjectRefused } from '../src/errors'
import { Projects, readFolder } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

/*
 * A project's repositories and names at their edges: a clone with no branch
 * checked out, a repository it doesn't have, a role there is no such thing
 * as, a change that changes nothing, and what Althar renames on its own.
 */

const open = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
})

describe('a folder read before it is opened', () => {
  it.effect('reads a clone with no branch checked out as on none', () =>
    Effect.gen(function* () {
      const path = repository()
      execFileSync('git', ['checkout', '-q', '--detach'], { cwd: path })
      const read = yield* readFolder(path)
      assert.strictEqual(read.kind, 'repository')
      assert.deepInclude(read.repositories[0], { branch: null, remote: null, folder: null })
    }),
  )
})

describe('a project’s repository, changed', () => {
  it.live('is refused for a repository it doesn’t have, or a role there is no such thing as, and does nothing where nothing changes', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const [repository] = yield* projects.repositories(project.projectId)
      const repositoryId = repository?.id ?? ''
      const gone = yield* Effect.flip(projects.setRepository({ projectId: project.projectId, repositoryId: 'repo_gone', role: 'docs' }))
      assert.instanceOf(gone, NotFound)
      const odd = yield* Effect.flip(projects.setRepository({ projectId: project.projectId, repositoryId, role: 'mascot' }))
      assert.deepInclude(odd, { _tag: 'ProjectRefused', reason: 'no_role' })
      assert.instanceOf(odd, ProjectRefused)
      const facts = sql<{ type: string }>`SELECT type FROM record_events WHERE project_id = ${project.projectId} ORDER BY sequence`
      const before = yield* facts
      yield* projects.setRepository({ projectId: project.projectId, repositoryId })
      assert.deepStrictEqual(yield* facts, before)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a project renamed or inked by Althar itself', () => {
  it.live('is recorded with no command of the person’s', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      yield* projects.rename(project.projectId, '  Meridian API  ')
      yield* projects.setInk(project.projectId, 'moss')
      const [row] = yield* sql<{ name: string; ink: string }>`SELECT name, ink FROM projects WHERE id = ${project.projectId}`
      assert.deepStrictEqual(row, { name: 'Meridian API', ink: 'moss' })
      const facts = yield* sql<{ type: string; commandId: string | null }>`
        SELECT type, command_id FROM record_events WHERE project_id = ${project.projectId}
          AND type IN ('project.renamed', 'project.ink_set') ORDER BY sequence`
      assert.deepStrictEqual(facts, [
        { type: 'project.renamed', commandId: null },
        { type: 'project.ink_set', commandId: null },
      ])
    }).pipe(Effect.provide(runtime())),
  )
})
