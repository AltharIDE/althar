import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Instance } from '../src/Instance'
import { Models } from '../src/Models'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { usableModels } from '../src/usableModels'
import { repository, runtime, until } from './support'

/*
 * The models work can go to now, as the coordinator lists them: on this
 * computer as a whole, and in a project whose rules name only an account
 * that has gone since.
 */

const agentsOf = (projectId?: string) =>
  Effect.map(usableModels(projectId), (usable) =>
    [...new Set(usable.flatMap((model) => model.routes.map((route) => route.agentId)))].toSorted(),
  )

describe('the models usable now', () => {
  it.live('are every signed-in agent’s on this computer, and in a project that names only an account gone since', () =>
    Effect.gen(function* () {
      const models = yield* Models
      const policies = yield* Policies
      const projects = yield* Projects
      const instance = yield* Instance
      yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
      assert.deepStrictEqual(yield* agentsOf(), ['claude-code', 'codex', 'opencode'])
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      // The project names for Codex only an account this computer doesn't have, as one removed since: it has all of them back.
      yield* policies.setAccounts(project.projectId, { rotate: false, only: { codex: ['acct_elsewhere'] } }, instance.personId)
      assert.deepStrictEqual(yield* agentsOf(project.projectId), ['claude-code', 'codex', 'opencode'])
    }).pipe(Effect.provide(runtime())),
  )
})
