import { execFileSync } from 'node:child_process'
import { renameSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from '../src/Config'
import { Coordinator } from '../src/Coordinator'
import { coordinatorMirrorAt } from '../src/coordinatorFolder'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { staleNotice, staleWords } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, notices, repository, runtime, turns, until } from './support'

/*
 * The coordinator's copies as fresh as Althar can make them (ADR-058): its
 * remotes fetched before each turn, with Althar's sign-in where it has one;
 * where one can't be, the coordinator is told with its turn and the person
 * in its thread, once, and it can ask for them again in the middle of a turn
 * with fetch_from_remote.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

/** A repository whose origin is a bare repository beside it, fetched once. */
const withRemote = () => {
  const person = repository()
  const remote = `${person}-remote.git`
  git(person, 'clone', '-q', '--bare', person, remote)
  git(person, 'remote', 'add', 'origin', remote)
  git(person, 'fetch', '-q', 'origin')
  return { person, remote }
}

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
  })

describe("the coordinator's copies, fetched for each turn", () => {
  it.live('tell the coordinator and the person, once, when the remote couldn’t be fetched, and come back when asked', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const config = yield* RuntimeConfig
      const { person, remote } = withRemote()
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: person })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      // The remote can't be reached, as offline.
      const away = `${remote}-away`
      renameSync(remote, away)
      yield* say(threadId, 'hello')
      const [first] = yield* until(turns(threadId), (rows) => rows.length === 1 && rows[0]?.state === 'completed')
      assert.include(first?.prompt, "Althar couldn't bring all your copies up to date with their remotes before this turn")
      assert.include(first?.prompt, 'is at origin/main as last fetched')
      yield* say(threadId, 'and now?')
      const second = yield* until(turns(threadId), (rows) => rows.length === 2 && rows[1]?.state === 'completed')
      assert.include(second[1]?.prompt, 'origin/main as last fetched')
      // The person is shown it once, not every turn.
      const shown = (yield* notices(threadId)).filter((notice) => notice.title?.startsWith('The coordinator is reading'))
      assert.lengthOf(shown, 1)
      assert.strictEqual(shown[0]?.severity, 'warning')
      assert.strictEqual(shown[0]?.description, 'Althar couldn’t fetch it from origin: it isn’t there any more.')

      // Back, with a commit pushed since: the coordinator asks for it in the middle of its turn.
      renameSync(away, remote)
      const elsewhere = `${person}-elsewhere`
      git(person, 'clone', '-q', remote, elsewhere)
      git(elsewhere, 'commit', '-q', '--allow-empty', '-m', 'Pushed since')
      git(elsewhere, 'push', '-q', 'origin', 'main')
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const said = yield* callTool(access, 'fetch_from_remote')
      assert.match(said, /origin\/main is at [0-9a-f]{12} \(Pushed since\)\./)
      assert.include(said, '`git fetch` in your copy brings what Althar fetched.')
      const [where] = yield* sql<{ project: string; binding: string }>`
        SELECT p.slug AS project, b.slug AS binding FROM projects p JOIN repository_bindings b ON b.project_id = p.id WHERE p.id = ${project.projectId}`
      const mirror = coordinatorMirrorAt(config.worktreeRoot, where?.project ?? '', where?.binding ?? '')
      assert.strictEqual(git(mirror, 'log', '-1', '--format=%s', 'refs/remotes/origin/main'), 'Pushed since')
      assert.include(yield* callTool(access, 'fetch_from_remote', { repository: 'nope' }), "There's no repository called nope")

      // Fetched again, the next turn says nothing of it.
      yield* say(threadId, 'thanks')
      const third = yield* until(turns(threadId), (rows) => rows.length === 3 && rows[2]?.state === 'completed')
      assert.notInclude(third[2]?.prompt, "Althar couldn't bring")
    }).pipe(Effect.provide(runtime())),
  )
})

describe('what is said of copies Althar couldn’t bring up to date', () => {
  it('names each, or all of them, and nothing where all are', () => {
    assert.isNull(staleWords([]))
    const one = {
      name: 'api',
      why: "Althar couldn't fetch origin: this computer looks offline",
      at: 'origin/main as last fetched',
      fetched: true,
    }
    assert.strictEqual(
      staleWords([one]),
      [
        "Althar couldn't bring all your copies up to date with their remotes before this turn, so they may be behind what was pushed:",
        "- Your copy of api is at origin/main as last fetched: Althar couldn't fetch origin: this computer looks offline.",
        'Say so where what you tell the person depends on it. fetch_from_remote tries again.',
      ].join('\n'),
    )
    // The person reads what the coordinator reads and why, in their words: no branch names.
    assert.deepStrictEqual(staleNotice([one]), {
      title: 'The coordinator is reading api as it was last fetched.',
      description: 'Althar couldn’t fetch it from origin: this computer looks offline.',
    })
    assert.strictEqual(staleNotice([{ ...one, fetched: false }]).title, 'The coordinator is reading api as this computer has it.')
    assert.deepStrictEqual(staleNotice([one, { ...one, name: 'web' }]), {
      title: 'The coordinator is reading api, web as this computer last had them.',
      description: 'Althar couldn’t fetch them before its turn, and tries again at the next.',
    })
    const all = { name: null, why: "Althar couldn't make them again", at: 'as they were before this turn', fetched: false }
    assert.include(staleWords([all]), "- Your copies are as they were before this turn: Althar couldn't make them again.")
    assert.strictEqual(staleNotice([all]).title, 'The coordinator is reading the repositories as this computer last had them.')
  })
})
