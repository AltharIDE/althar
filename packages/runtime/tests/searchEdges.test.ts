import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { findTasks } from '../src/Search'
import { repository, runtime } from './support'

/*
 * Finding tasks with more words than Althar reads of what is typed: the
 * first of them find a task by its title, and nothing more is said to have
 * matched, as the words past them are in none of it.
 */

describe('finding tasks by more words than are read', () => {
  it.live('finds a task by the first of them in its title, saying nothing more matched', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const title = 'Retry the checkout when the card is declined twice in one row'
      yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title }),
        projectId: project.projectId,
        title,
        description: 'Fix bugs.',
        request: 'Fix bugs.',
        // A plain task, with no branch yet to be found by.
        plain: true,
      })
      const [found] = yield* findTasks({ text: `${title} yesterday` }, new Set())
      assert.strictEqual(found?.title, title)
      assert.isNull(found?.matched)
    }).pipe(Effect.provide(runtime())),
  )
})
