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
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { reachedRemote, sshConfigSays } from '../src/sshHosts'
import { HOST, repository, until } from './support'

import { ask, cards, connect, runtimeWith } from './changesSupport'

/*
 * A repository's remotes are what its clone has, not only what it had when
 * it was added (recordedRemotes.ts): a remote added after, as a fresh
 * repository gets one once it is made on GitHub, is where its pull request
 * opens. And an SSH remote whose host Althar doesn't know is looked up as
 * ssh reaches it: `github.com-work`, which ~/.ssh/config makes github.com
 * for a second account's key, is on GitHub; one Althar knows stays as
 * written, whatever the config sends it to (sshHosts.ts).
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

/** The hosts Althar knows in these: GitHub's, GitLab's, and a company's own GitLab. */
const knows = (host: string) => ['github.com', 'gitlab.com', 'git.corp.example'].includes(host)

describe('a remote’s host, as Althar looks it up', () => {
  it.effect('is the host an SSH alias stands for, where Althar knows that host and not the alias', () =>
    Effect.gen(function* () {
      sshConfigSays({ 'github.com-work': 'github.com', 'gitlab-ssh': 'gitlab.com', 'gh-443': 'ssh.github.com' })
      assert.strictEqual(yield* reachedRemote('git@github.com-work:meridian/api.git', knows), 'git@github.com:meridian/api.git')
      assert.strictEqual(
        yield* reachedRemote('ssh://git@gitlab-ssh:2222/fnt/engine.git', knows),
        'ssh://git@gitlab.com:2222/fnt/engine.git',
      )
      assert.strictEqual(yield* reachedRemote('github.com-work:meridian/api.git', knows), 'github.com:meridian/api.git')
      // An alias for GitHub's port-443 name is GitHub, and so is that name written as the remote's.
      assert.strictEqual(yield* reachedRemote('git@gh-443:meridian/api.git', knows), 'git@github.com:meridian/api.git')
      assert.strictEqual(
        yield* reachedRemote('ssh://git@ssh.github.com:443/meridian/api.git', knows),
        'ssh://git@github.com:443/meridian/api.git',
      )
    }),
  )

  it.effect('stays as written where Althar knows the host, whatever ssh’s config sends it to', () =>
    Effect.gen(function* () {
      // GitHub's own way through port 443 (Host github.com, HostName ssh.github.com), a company's mirror, and a config that
      // names the same host.
      sshConfigSays({ 'github.com': 'ssh.github.com', 'git.corp.example': '10.0.0.5', 'gitlab.com': 'gitlab.com' })
      for (const remote of ['git@github.com:meridian/api.git', 'git@git.corp.example:fnt/engine.git', 'git@gitlab.com:fnt/engine.git'])
        assert.strictEqual(yield* reachedRemote(remote, knows), remote)
    }),
  )

  it.effect('stays as written where neither it nor ssh’s answer is a host Althar knows, and for an https remote or a path', () =>
    Effect.gen(function* () {
      sshConfigSays({ 'box-alias': 'box.lan', 'github.com-work': 'github.com' })
      for (const remote of [
        'git@box-alias:me/api.git',
        'https://github.com-work/meridian/api.git',
        '/srv/git/api.git',
        'C:\\code\\api',
        'file:///srv/git/api.git',
      ])
        assert.strictEqual(yield* reachedRemote(remote, knows), remote)
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

  it.live('finds a remote added while Althar runs where its host is asked for, as the card asks', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      yield* connect('github', HOST)
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      assert.deepStrictEqual(yield* recorded(project.projectId), [])
      withOrigin(working, `${HOST}/meridian/api.git`)
      assert.deepInclude(yield* changes.hostFor(project.projectId), { name: 'GitHub', connected: true })
      assert.deepStrictEqual(yield* recorded(project.projectId), [`${HOST}/meridian/api.git`])
    }).pipe(Effect.provide(runtimeWith({ github: makeFakeService() })))
  })

  it.live('reads every repository’s remotes again at launch, so one added while Althar was closed is recorded', () => {
    const working = repository()
    const database = join(mkdtempSync(join(tmpdir(), 'althar-remotes-')), 'althar.sqlite')
    const github = makeFakeService()
    return Effect.gen(function* () {
      const projectId = yield* Effect.scoped(
        Effect.gen(function* () {
          const projects = yield* Projects
          const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
          assert.deepStrictEqual(yield* recorded(project.projectId), [])
          return project.projectId
        }).pipe(Effect.provide(runtimeWith({ github }, database))),
      )
      // Made on GitHub while Althar was closed.
      withOrigin(working, `${HOST}/meridian/api.git`)
      // Launched again, nothing asked of it: the launch reads it.
      yield* Effect.scoped(
        until(recorded(projectId), (remotes) => remotes.length > 0).pipe(
          Effect.map((remotes) => assert.deepStrictEqual(remotes, [`${HOST}/meridian/api.git`])),
          Effect.provide(runtimeWith({ github }, database)),
        ),
      )
    })
  })

  it.live('finds the host of an SSH alias from ~/.ssh/config, the remote kept as written, and opens the pull request there', () => {
    const working = repository()
    sshConfigSays({ 'github.test-personal': 'github.test' })
    const bare = withOrigin(working, 'git@github.test-personal:meridian/api.git')
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      yield* connect('github', HOST)
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      // Kept as git has it: the alias says which key, and so which account, the clone pushes as.
      assert.deepStrictEqual(yield* recorded(project.projectId), ['git@github.test-personal:meridian/api.git'])
      assert.deepInclude(yield* changes.hostFor(project.projectId), { name: 'GitHub', connected: true })
      assert.strictEqual(yield* changes.endFor(project.projectId), 'draft')
      yield* ask(working, PLAN)
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual(github.changes[0]?.state, 'open')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('keeps finding a connected host whose name ssh’s config sends elsewhere, as for GitHub over port 443', () => {
    const working = repository()
    sshConfigSays({ 'github.test': 'ssh.github.test' })
    withOrigin(working, 'git@github.test:meridian/api.git')
    return Effect.gen(function* () {
      const projects = yield* Projects
      const changes = yield* Changes
      yield* connect('github', HOST)
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      assert.deepStrictEqual(yield* recorded(project.projectId), ['git@github.test:meridian/api.git'])
      assert.deepInclude(yield* changes.hostFor(project.projectId), { name: 'GitHub', connected: true })
      assert.strictEqual(yield* changes.endFor(project.projectId), 'draft')
    }).pipe(Effect.provide(runtimeWith({ github: makeFakeService() })))
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
