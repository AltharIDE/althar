import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { pathsPushed } from '../src/repositoryGuard'
import * as Runtime from '../src/Runtime'
import { words } from '../src/words'
import { repository, runtime } from './support'

/*
 * The push guard (docs/plans/skills-across-harnesses.md, section 4): skill and OpenSpec files do not leave the
 * machine unless the project says so, found by path alone, whoever wrote them and however git would quote them.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

const commitFiles = (cwd: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), text)
  }
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', 'Write files')
  return git(cwd, 'rev-parse', 'HEAD')
}

describe('the paths a push would send', () => {
  it.live('reads them unquoted, with a rename as both its paths, and every path without a base', () =>
    Effect.gen(function* () {
      const root = repository()
      const base = git(root, 'rev-parse', 'HEAD')
      commitFiles(root, { 'src/odd name "q".ts': 'x', '.claude/skills/old/SKILL.md': 'old', 'é/ü.md': 'u' })
      const before = git(root, 'rev-parse', 'HEAD')
      git(root, 'mv', '.claude/skills/old/SKILL.md', 'docs-old.md')
      git(root, 'commit', '-q', '-m', 'Move')
      const head = git(root, 'rev-parse', 'HEAD')
      assert.deepStrictEqual((yield* pathsPushed(root, base, before)).toSorted(), [
        '.claude/skills/old/SKILL.md',
        'src/odd name "q".ts',
        'é/ü.md',
      ])
      assert.deepStrictEqual((yield* pathsPushed(root, before, head)).toSorted(), ['.claude/skills/old/SKILL.md', 'docs-old.md'])
      // With no base recorded, from where the branch left the default branch; only then, failing that, every commit's paths.
      assert.deepStrictEqual(yield* pathsPushed(root, null, head, 'main'), [])
      assert.deepStrictEqual((yield* pathsPushed(root, null, head, 'no-such-ref')).toSorted(), [
        '.claude/skills/old/SKILL.md',
        'README.md',
        'docs-old.md',
        'src/odd name "q".ts',
        'é/ü.md',
      ])
    }),
  )

  it.live('leaves out what came in with the default branch, but not what a merge slipped in', () =>
    Effect.gen(function* () {
      const root = repository()
      const base = git(root, 'rev-parse', 'HEAD')
      git(root, 'checkout', '-q', '-b', 'task')
      commitFiles(root, { 'src/mine.ts': 'mine' })
      // The default branch moves on with skill and OpenSpec files of its own, fetched where Althar keeps it.
      git(root, 'checkout', '-q', 'main')
      const main = commitFiles(root, { '.claude/skills/theirs/SKILL.md': 'theirs', 'openspec/project.md': 'spec' })
      git(root, 'update-ref', 'refs/althar/base/main', main)
      git(root, 'checkout', '-q', 'task')
      git(root, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'merge', '-q', '--no-edit', main)
      const merged = git(root, 'rev-parse', 'HEAD')
      assert.deepStrictEqual(yield* pathsPushed(root, base, merged, 'main'), ['src/mine.ts'])
      // A resolution that adds a skill the default branch never had is the task's own.
      git(root, 'reset', '-q', '--hard', 'HEAD~1')
      git(root, '-c', 'user.name=T', '-c', 'user.email=t@t.test', 'merge', '-q', '--no-commit', main)
      mkdirSync(join(root, '.claude/skills/slipped'), { recursive: true })
      writeFileSync(join(root, '.claude/skills/slipped/SKILL.md'), 'slipped')
      git(root, 'add', '-A')
      git(root, 'commit', '-q', '--no-edit')
      assert.deepStrictEqual((yield* pathsPushed(root, base, git(root, 'rev-parse', 'HEAD'), 'main')).toSorted(), [
        '.claude/skills/slipped/SKILL.md',
        'src/mine.ts',
      ])
    }),
  )
})

/** A project with a task whose origin is a bare repository here, as the localMerge tests make one. */
const taskWithRemote = Effect.gen(function* () {
  const root = repository()
  git(root, 'config', 'user.name', 'T')
  git(root, 'config', 'user.email', 't@t.test')
  const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'push', '-q', 'origin', 'main')
  git(root, 'fetch', '-q', 'origin')
  git(root, 'branch', '-q', '--set-upstream-to=origin/main', 'main')
  const projects = yield* Projects
  const sql = yield* SqlClient.SqlClient
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Add a skill',
  })
  const [worktree] = yield* sql<{ slug: string; path: string }>`
    SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId}`
  const path = worktree?.path ?? ''
  return { project, task, remote, slug: worktree?.slug ?? '', path, branch: git(path, 'rev-parse', '--abbrev-ref', 'HEAD') }
})

const refusal = (failure: unknown) => failure as { _tag?: string; why?: string; said?: string; needs?: ReadonlyArray<string> }

describe('pushing a task’s branch', () => {
  it.live('holds back skill and OpenSpec files by default, whoever wrote them, and sends everything else', () =>
    Effect.gen(function* () {
      const { task, remote, slug, path, branch } = yield* taskWithRemote
      const changes = yield* Changes
      const head = commitFiles(path, {
        'src/ok.ts': 'ok',
        'apps/web/.opencode/skills/we ird/SKILL.md': 'skill',
        'openspec/changes/a/proposal.md': 'spec',
      })
      const refused = refusal(yield* Effect.flip(changes.pushBranch(task.taskId, [{ repository: slug, head }])))
      assert.strictEqual(refused._tag, 'PushRefused')
      assert.strictEqual(refused.why, 'protected')
      assert.include(refused.said, 'apps/web/.opencode/skills/we ird/SKILL.md')
      assert.include(refused.said, 'openspec/changes/a/proposal.md')
      // The person is told which settings allow it, and where they are.
      assert.deepStrictEqual(refused.needs, ['writeSkills', 'writeOpenSpec', 'pushProtected'])
      assert.include(
        words(refused, (id) => id).message,
        'turn on “Write Althar-managed skills”, “Write OpenSpec artifacts” and “Push skill/OpenSpec files” in the project’s Settings, under Repository files',
      )
      // Nothing left the machine.
      assert.strictEqual(execFileSync('git', ['branch', '--list', branch], { cwd: remote }).toString().trim(), '')
      // The same commits without them go.
      git(path, 'rm', '-rq', 'apps', 'openspec')
      git(path, 'commit', '-q', '-m', 'Take them out')
      const clean = git(path, 'rev-parse', 'HEAD')
      // The commit that added them is still in the branch's history, but what is pushed is what the branch changed: none now.
      assert.deepStrictEqual(yield* changes.pushBranch(task.taskId, [{ repository: slug, head: clean }]), [{ branch, remote: 'origin' }])
      assert.strictEqual(git(remote, 'ls-tree', '-r', '--name-only', branch).split('\n').toSorted().join(','), 'README.md,src/ok.ts')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('sends them only once the project allows both writing and pushing them', () =>
    Effect.gen(function* () {
      const { project, task, remote, slug, path, branch } = yield* taskWithRemote
      const changes = yield* Changes
      const policies = yield* Policies
      const person = (yield* Instance).personId
      const head = commitFiles(path, { '.claude/skills/x/SKILL.md': 'skill' })
      yield* policies.set(project.projectId, { repositoryFiles: { writeSkills: true, writeOpenSpec: true, pushProtected: false } }, person)
      assert.deepStrictEqual(refusal(yield* Effect.flip(changes.pushBranch(task.taskId, [{ repository: slug, head }]))).needs, [
        'pushProtected',
      ])
      // Pushing alone is not enough: the files were never allowed into the repository, and the person is told so.
      yield* policies.set(project.projectId, { repositoryFiles: { writeSkills: false, writeOpenSpec: false, pushProtected: true } }, person)
      const unwritten = refusal(yield* Effect.flip(changes.pushBranch(task.taskId, [{ repository: slug, head }])))
      assert.strictEqual(unwritten.why, 'protected')
      assert.deepStrictEqual(unwritten.needs, ['writeSkills'])
      assert.include(words(unwritten, (id) => id).message, 'To push it, turn on “Write Althar-managed skills” in the project’s Settings')
      yield* policies.set(project.projectId, { repositoryFiles: { writeSkills: true, writeOpenSpec: false, pushProtected: true } }, person)
      assert.deepStrictEqual(yield* changes.pushBranch(task.taskId, [{ repository: slug, head }]), [{ branch, remote: 'origin' }])
      assert.include(git(remote, 'ls-tree', '-r', '--name-only', branch), '.claude/skills/x/SKILL.md')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('does not hold back skill files the repository already had, even with no base commit recorded', () =>
    Effect.gen(function* () {
      const root = repository()
      commitFiles(root, { '.claude/skills/team/SKILL.md': 'the team’s own' })
      const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
      git(remote, 'init', '-q', '--bare', '-b', 'main')
      git(root, 'remote', 'add', 'origin', remote)
      git(root, 'push', '-q', 'origin', 'main')
      git(root, 'fetch', '-q', 'origin')
      git(root, 'branch', '-q', '--set-upstream-to=origin/main', 'main')
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Edit',
      })
      const [worktree] = yield* sql<{ slug: string; path: string }>`
        SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${task.taskId}`
      yield* sql`UPDATE workspaces SET base_commit = NULL WHERE task_id = ${task.taskId}`
      const head = commitFiles(worktree?.path ?? '', { 'src/new.ts': 'new' })
      const pushed = yield* (yield* Changes).pushBranch(task.taskId, [{ repository: worktree?.slug ?? '', head }])
      assert.strictEqual(pushed.length, 1)
    }).pipe(Effect.provide(runtime())),
  )
})
