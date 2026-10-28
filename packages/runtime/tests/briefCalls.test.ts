import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { projectOverview } from '../src/handover'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

/*
 * What a fresh coordinator session is told of the project, where
 * handoverEdges.test.ts doesn't go: a repository whose default branch
 * Althar doesn't know.
 */

describe('a handover brief', () => {
  it.live('says a repository whose default branch Althar doesn’t know is on main', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* sql`UPDATE repository_bindings SET default_base_ref = NULL WHERE project_id = ${projectId as ProjectId}`
      assert.match(yield* projectOverview(projectId), /^- .+ \(main\), on this computer at /m)
    }).pipe(Effect.provide(runtime())),
  )
})
