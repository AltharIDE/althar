import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotARepository, NotFound } from '../src/errors'
import { Projects, slugify } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

describe('projects', () => {
  it.live('opens a folder in a repository as a project, with its repository and a coordinator thread', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const path = repository()
      git(path, 'remote', 'add', 'origin', 'git@github.com:meridian/app.git')
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', { path }), path: join(path, '.') })
      const [binding] = yield* sql<{
        remoteFingerprints: string
        defaultBaseRef: string
      }>`SELECT remote_fingerprints, default_base_ref FROM repository_bindings`
      assert.deepStrictEqual(JSON.parse(binding?.remoteFingerprints ?? '[]'), ['git@github.com:meridian/app.git'])
      assert.strictEqual(binding?.defaultBaseRef, 'main')
      const [thread] = yield* sql<{ kind: string }>`SELECT kind FROM threads WHERE id = ${opened.coordinatorThreadId}`
      assert.strictEqual(thread?.kind, 'coordinator')

      // Opening it again, from a folder inside it, finds the same project.
      const again = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', { path }), path })
      assert.deepStrictEqual(again, opened)
      const [count] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM projects`
      assert.strictEqual(count?.count, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('refuses a folder outside any repository', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const path = mkdtempSync(join(tmpdir(), 'althar-plain-'))
      const error = yield* Effect.flip(projects.open({ envelope: yield* Runtime.envelope('project.open', { path }), path }))
      assert.instanceOf(error, NotARepository)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('gives two projects with the same name different slugs', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const first = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const second = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      assert.notStrictEqual(first.slug, second.slug)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('creates a task with its own worktree, on its own branch, from the default branch', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const path = repository()
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
      const create = (title: string) =>
        Effect.flatMap(Runtime.envelope('task.create', { title }), (envelope) =>
          projects.createTask({ envelope, projectId: project.projectId, title }),
        )
      const created = yield* create('Retry the checkout!')
      assert.strictEqual(created.slug, 'retry-the-checkout')
      assert.strictEqual(created.branch, 'althar/retry-the-checkout')
      assert.isTrue(created.worktree.endsWith(join(project.slug, 'retry-the-checkout', slugify(project.name, 'repository'))))
      assert.isTrue(existsSync(join(created.worktree, 'README.md')))
      assert.strictEqual(git(created.worktree, 'branch', '--show-current'), 'althar/retry-the-checkout')
      const [workspace] = yield* sql<{
        state: string
        baseCommit: string
      }>`SELECT state, base_commit FROM workspaces WHERE id = ${created.workspaceId}`
      assert.deepStrictEqual(workspace, { state: 'ready', baseCommit: git(path, 'rev-parse', 'main') })
      assert.strictEqual((yield* create('Retry the checkout')).slug, 'retry-the-checkout-2')
      assert.strictEqual((yield* create('Retry the checkout')).slug, 'retry-the-checkout-3')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a worktree git could not add as failed', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const path = repository()
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
      yield* sql`UPDATE repository_bindings SET default_base_ref = 'no-such-branch'`
      const error = yield* Effect.flip(
        projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId: project.projectId, title: 'Doomed' }),
      )
      assert.strictEqual(error._tag, 'GitFailed')
      const [workspace] = yield* sql<{ state: string }>`SELECT state FROM workspaces`
      assert.strictEqual(workspace?.state, 'failed')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says when the project does not exist', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const error = yield* Effect.flip(
        projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId: 'proj_nothing', title: 'x' }),
      )
      assert.instanceOf(error, NotFound)
    }).pipe(Effect.provide(runtime())),
  )

  it('makes slugs from names', () => {
    assert.strictEqual(slugify('  Café Déjà Vu  ', 'x'), 'cafe-deja-vu')
    assert.strictEqual(slugify('!!!', 'task'), 'task')
    assert.strictEqual(slugify('a'.repeat(60), 'x').length, 48)
  })

  describe('worktrees', () => {
    const git = (cwd: string, ...args: Array<string>) =>
      execFileSync('git', args, {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'T',
          GIT_AUTHOR_EMAIL: 't@t.test',
          GIT_COMMITTER_NAME: 'T',
          GIT_COMMITTER_EMAIL: 't@t.test',
        },
      })
        .toString()
        .trim()
    const create = (projectId: string, title: string) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        return yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', { title }), projectId, title })
      })

    it.live('fetches first, and starts the task from the default branch as origin has it', () =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const upstream = repository()
        const clone = mkdtempSync(join(tmpdir(), 'althar-clone-'))
        execFileSync('git', ['clone', '-q', upstream, clone])
        // Someone else moves main on after the clone.
        writeFileSync(join(upstream, 'later.md'), 'later\n')
        git(upstream, 'add', '.')
        git(upstream, 'commit', '-q', '-m', 'Later')
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: clone })
        const created = yield* create(project.projectId, 'Use the latest')
        const [workspace] = yield* sql<{ baseRef: string; baseCommit: string }>`SELECT base_ref, base_commit FROM workspaces`
        assert.deepStrictEqual(workspace, { baseRef: 'origin/main', baseCommit: git(upstream, 'rev-parse', 'main') })
        assert.isTrue(existsSync(join(created.worktree, 'later.md')))
      }).pipe(Effect.provide(runtime())),
    )

    it.live('picks a free branch and folder when the planned ones exist', () =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const path = repository()
        git(path, 'branch', 'althar/tidy-up')
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
        const created = yield* create(project.projectId, 'Tidy up')
        assert.strictEqual(created.branch, 'althar/tidy-up-2')
        assert.isTrue(created.worktree.endsWith('-2'))
        assert.strictEqual(git(created.worktree, 'branch', '--show-current'), 'althar/tidy-up-2')
      }).pipe(Effect.provide(runtime())),
    )

    it.live("never runs the repository's own hooks", () =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const path = repository()
        const marker = join(mkdtempSync(join(tmpdir(), 'althar-hook-')), 'ran')
        writeFileSync(join(path, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 })
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
        yield* create(project.projectId, 'No hooks')
        assert.isFalse(existsSync(marker))
      }).pipe(Effect.provide(runtime())),
    )

    it.live('keeps credentials in remote URLs out of the record', () =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const path = repository()
        git(path, 'remote', 'add', 'origin', 'https://ada:ghp_secret@github.com/meridian/app.git')
        git(path, 'remote', 'add', 'mirror', 'git@github.com:meridian/app.git')
        yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
        const rows = yield* sql<{ text: string }>`
          SELECT remote_fingerprints AS text FROM repository_bindings
          UNION ALL SELECT observed_remotes FROM repository_locations
          UNION ALL SELECT payload FROM record_events`
        assert.isFalse(rows.some((row) => row.text.includes('ghp_secret') || row.text.includes('ada:')))
        assert.include(rows[0]?.text ?? '', 'https://github.com/meridian/app.git')
        assert.include(rows[0]?.text ?? '', 'git@github.com:meridian/app.git')
      }).pipe(Effect.provide(runtime())),
    )

    it.live('takes the usual default branch, not whatever the person has checked out', () =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const path = repository()
        git(path, 'checkout', '-q', '-b', 'feature/wip')
        yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
        const [binding] = yield* sql<{ defaultBaseRef: string }>`SELECT default_base_ref FROM repository_bindings`
        assert.strictEqual(binding?.defaultBaseRef, 'main')
      }).pipe(Effect.provide(runtime())),
    )
  })
})
