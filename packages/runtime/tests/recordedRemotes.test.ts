import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { afterEach } from 'vitest'

import { Changes } from '../src/Changes'
import { reachedRemote, sshConfigSays } from '../src/git'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { HOST, repository, until } from './support'

import { ask, cards, connect, runtimeWith } from './changesSupport'

/*
 * A repository's remotes are what its clone has, not only what it had when
 * it was added (recordedRemotes.ts): a remote added after, as a fresh
 * repository gets one once it is made on GitHub, is where its pull request
 * opens. And an SSH remote is read as ssh reaches it: `github.com-work`,
 * which ~/.ssh/config makes github.com for a second account's key, is on
 * GitHub (git.ts).
 */

afterEach(() => sshConfigSays(undefined))

const recorded = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      remotes: string
    }>`SELECT remote_fingerprints AS remotes FROM repository_bindings WHERE project_id = ${projectId}`
    return JSON.parse(row?.remotes ?? '[]') as ReadonlyArray<string>
  })

/** A clone whose origin is added as `origin` says, and the bare repository the fake host pushes to. */
const withOrigin = (working: string, origin: string) => {
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: working })
  const bare = mkdtempSync(join(tmpdir(), 'althar-remote-'))
  execFileSync('git', ['clone', '-q', '--bare', working, bare])
  return bare
}

const PLAN = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]'

describe('a remote as ssh reaches it', () => {
  it.effect('names the host an SSH alias stands for, and leaves every other remote as it was', () =>
    Effect.gen(function* () {
      sshConfigSays({ 'github.com-work': 'github.com', 'gitlab-ssh': 'gitlab.example.org' })
      assert.strictEqual(yield* reachedRemote('git@github.com-work:meridian/api.git'), 'git@github.com:meridian/api.git')
      assert.strictEqual(
        yield* reachedRemote('ssh://git@gitlab-ssh:2222/fnt/engine.git'),
        'ssh://git@gitlab.example.org:2222/fnt/engine.git',
      )
      assert.strictEqual(yield* reachedRemote('github.com-work:meridian/api.git'), 'github.com:meridian/api.git')
      // An https remote isn't ssh's, nor one ssh's config says nothing of, nor a path.
      assert.strictEqual(yield* reachedRemote('https://github.com-work/meridian/api.git'), 'https://github.com-work/meridian/api.git')
      assert.strictEqual(yield* reachedRemote('git@github.com:meridian/api.git'), 'git@github.com:meridian/api.git')
      assert.strictEqual(yield* reachedRemote('/srv/git/api.git'), '/srv/git/api.git')
      assert.strictEqual(yield* reachedRemote('C:\\code\\api'), 'C:\\code\\api')
    }),
  )
})

describe('where a repository’s pull request opens', () => {
  it.live('finds a remote added after the repository was, for its host and its pull request', () => {
    const working = repository()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    let bare = ''
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      yield* connect('github', HOST)
      // Added with no remote: git init, then Althar, then the repository made on GitHub.
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      assert.deepStrictEqual(yield* recorded(project.projectId), [])
      assert.isNull(yield* changes.endFor(project.projectId))
      bare = withOrigin(working, `${HOST}/meridian/api.git`)
      // Its ending is worked out from the remote it has now.
      assert.strictEqual(yield* changes.endFor(project.projectId), 'draft')
      assert.deepStrictEqual(yield* recorded(project.projectId), [`${HOST}/meridian/api.git`])
      assert.deepInclude(yield* changes.hostFor(project.projectId), { name: 'GitHub', connected: true })
      // And a task's work opens its pull request there.
      yield* ask(working, PLAN)
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual(github.changes[0]?.state, 'open')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('finds the host of an SSH alias from ~/.ssh/config, recorded so before or not, and opens the pull request there', () => {
    const working = repository()
    sshConfigSays({ 'github.test-personal': 'github.test' })
    const bare = withOrigin(working, 'git@github.test-personal:meridian/api.git')
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      const sql = yield* SqlClient.SqlClient
      yield* connect('github', HOST)
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      assert.deepStrictEqual(yield* recorded(project.projectId), ['git@github.test:meridian/api.git'])
      // As a project made before Althar read aliases has it: the alias, a host no one knows.
      yield* sql`UPDATE repository_bindings SET remote_fingerprints = ${JSON.stringify(['git@github.test-personal:meridian/api.git'])}`
      assert.isNull(yield* changes.hostFor(project.projectId))
      // Its ending reads the remote again, as ssh reaches it.
      assert.strictEqual(yield* changes.endFor(project.projectId), 'draft')
      assert.deepInclude(yield* changes.hostFor(project.projectId), { name: 'GitHub', connected: true })
      yield* ask(working, PLAN)
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual(github.changes[0]?.state, 'open')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('knows no host for a repository with no remote', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      yield* connect('github', HOST)
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      assert.isNull(yield* changes.endFor(project.projectId))
      assert.isNull(yield* changes.hostFor(project.projectId))
    }).pipe(Effect.provide(runtimeWith({ github: makeFakeService() })))
  })
})
