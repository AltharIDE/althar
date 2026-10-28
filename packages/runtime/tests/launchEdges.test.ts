import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

/*
 * The project run by Althar itself, where launches.test.ts and
 * launchPlaces.test.ts don't go: a repository whose default branch Althar
 * doesn't know.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

/** A repository whose package.json runs this as its dev script. */
const running = (dev: string) => {
  const path = repository()
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'meridian', scripts: { dev } }))
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Run')
  return path
}

const open = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  })

describe('running the project', () => {
  it.live('runs a copy of main where the repository’s default branch isn’t known, and says it is on main', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const sql = yield* SqlClient.SqlClient
      const { projectId } = yield* open(running('node -e "setInterval(() => {}, 1000)"'))
      yield* sql`UPDATE repository_bindings SET default_base_ref = NULL WHERE project_id = ${projectId as ProjectId}`
      const started = yield* launches.start({ projectId, taskId: null, threadId: null })
      assert.deepInclude(started, { taskId: null, where: 'main', ended: null })
      yield* launches.stop(started.id)
    }).pipe(Effect.provide(runtime())),
  )
})
