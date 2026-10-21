import { execFileSync } from 'node:child_process'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { HOST, hosted, until } from './support'
import { PASSED, ask, asked, cards, conflictsIn, connect, moveHostMainOn, rounds, runtimeWith, titled } from './conflictsSupport'

/*
 * A conflict the host reports on a pull request from a fork into the
 * repository it came from: the lead merges that repository's default branch,
 * as `upstream` names it in the fork's clone, and Althar pushes the merge to
 * the fork's branch.
 */

describe('a conflict on a pull request from a fork into the repository it came from', () => {
  it.live('is resolved from upstream’s default branch, and the merge pushed to the fork', () => {
    const { working, bare } = hosted(['you', 'api'])
    execFileSync('git', ['remote', 'add', 'upstream', `${HOST}/meridian/api.git`], { cwd: working })
    const tip = () => {
      try {
        return execFileSync('git', ['rev-parse', 'althar/add-a-retry'], { cwd: bare }).toString().trim()
      } catch {
        return null
      }
    }
    // Both the fork and the repository it came from are the bare repository here.
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tip,
      conflictsOf: () => (tip() === null ? undefined : conflictsIn(bare, 'main', 'althar/add-a-retry')),
      checksFor: () => PASSED,
    })
    github.addRepository(['you', 'api'])
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const [repository] = yield* projects.repositories(project.projectId)
      yield* projects.setRepository({ projectId: project.projectId, repositoryId: repository?.id ?? '', changeTarget: 'upstream' })
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null, Duration.seconds(20))
      assert.strictEqual(ready?.change?.url, 'https://github.com/meridian/api/pull/1')
      const threadId = ready?.threadId ?? ''
      // Upstream's main moves on, conflicting with the task's change.
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      const [note] = yield* asked(threadId)
      assert.include(note, 'merge upstream/main into it')
      assert.strictEqual(execFileSync('git', ['merge-base', '--is-ancestor', 'main', 'althar/add-a-retry'], { cwd: bare }).toString(), '')
      const [round] = yield* rounds(ready?.taskId ?? '')
      assert.strictEqual(round?.url, 'https://github.com/meridian/api/pull/1')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
