import { lstatSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readInstalls, withInstall, writeInstalls } from '@althar/skills'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { install, run } from '../../skills/tests/support'

import {
  agentTools,
  forgetSkillRoles,
  heldSkillsFor,
  repositoryRoots,
  setSkillRoles,
  setToolInProject,
  setToolRoles,
} from '../src/agentTools'
import { Sessions } from '../src/Sessions'
import { turnSkillsOn } from '../src/skillSync'
import { items, launches, runtime, sessionMetas, sessionsAsked, task, until } from './support'

/*
 * The person's skills as one list, from each place they are kept, and which roles
 * and projects each is given in (ADR-097, "Skills"): in a home of the test's own,
 * never the real `~/.claude`, `~/.agents` or `~/.config/opencode`, with a store of
 * the test's own. What each agent's session carries for those held back is the
 * registry's (`provider-adapters/tests/heldSkills.test.ts`); here, which are held.
 */

const skillMd = (name: string, description = `Use when testing ${name}.`, called = name) =>
  `---\nname: ${called}\ndescription: ${description}\n---\nDo ${name}.\n`

const put = (folder: string, name: string, text = skillMd(name)) => {
  mkdirSync(join(folder, name), { recursive: true })
  writeFileSync(join(folder, name, 'SKILL.md'), text)
}

/** A home with skills in each agent's folder and one Claude Code plugin on (another off), and a store beside it. */
const setUp = async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-skill-home-'))
  put(join(home, '.claude', 'skills'), 'impeccable', skillMd('impeccable', 'Design that holds up.'))
  put(join(home, '.claude', 'skills'), 'shared', skillMd('shared', 'In the store too.'))
  put(join(home, '.agents', 'skills'), 'write-docs', skillMd('write-docs', 'Docs.', 'docs-writer'))
  const plugins = join(home, '.claude', 'plugins')
  for (const plugin of ['superpowers', 'quiet']) put(join(plugins, 'cache', 'market', plugin, '1.0.0', 'skills'), `${plugin}-skill`)
  mkdirSync(plugins, { recursive: true })
  writeFileSync(
    join(plugins, 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: Object.fromEntries(
        ['superpowers', 'quiet'].map((plugin) => [
          `${plugin}@market`,
          [{ scope: 'user', installPath: join(plugins, 'cache', 'market', plugin, '1.0.0'), version: '1.0.0' }],
        ]),
      ),
    }),
  )
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'superpowers@market': true, 'quiet@market': false } }),
  )
  const store = mkdtempSync(join(tmpdir(), 'althar-skill-store-'))
  await install(store, 'alpha', { 'SKILL.md': skillMd('alpha', 'From GitHub.') })
  await install(store, 'shared', { 'SKILL.md': skillMd('shared', 'The store’s own.') })
  await install(store, 'resting', { 'SKILL.md': skillMd('resting') }, false)
  // Added from GitHub at a commit.
  const installs = await run(readInstalls(store))
  const alpha = installs.installs.find((one) => one.id === 'alpha')!
  await run(
    writeInstalls(
      store,
      withInstall(installs, {
        ...alpha,
        source: 'github',
        repo: 'someone/skills',
        subpath: 'skills/alpha',
        ref: 'main',
        sha: 'a'.repeat(40),
      }),
    ),
  )
  return { home, store, folder: join(home, 'althar-profile') }
}

const withSetUp = <A, E, R>(body: (paths: Awaited<ReturnType<typeof setUp>>) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(
    Effect.promise(() => setUp()),
    (paths) =>
      body(paths).pipe(
        Effect.provide(
          runtime(':memory:', {}, { agentConfigs: { homeDir: paths.home, folder: paths.folder, env: {} }, skills: { root: paths.store } }),
        ),
      ),
  )

/** Where a repository keeps its own skills, as a row names it (written out so it isn't read as a path to a file). */
const REPOSITORY_SKILLS = ['.claude', 'skills'].join('/')

/** A project with a skill of its repository's own in its checkout's folder for skills. */
const projectWithSkill = Effect.gen(function* () {
  const made = yield* task()
  const [root = ''] = yield* repositoryRoots(made.project.projectId)
  put(join(root, '.claude', 'skills'), 'repo-rules', skillMd('repo-rules', 'How this repository is worked on.'))
  return made
})

describe('the person’s skills, as one list', () => {
  it.live('lists each from where it is kept, with where it lives, where it came from and how each agent has it', () =>
    withSetUp(() =>
      Effect.gen(function* () {
        const { project } = yield* projectWithSkill
        const rows = (yield* agentTools(null)).skills
        const by = (name: string) => rows.find((one) => one.name === name)
        assert.deepStrictEqual(
          rows.map((one) => one.name),
          ['alpha', 'impeccable', 'resting', 'shared', 'superpowers:superpowers-skill', 'write-docs', 'repo-rules'],
        )
        // An agent's own folder: as the person names it, with what its SKILL.md says it is for.
        assert.deepInclude(by('impeccable'), {
          about: 'Design that holds up.',
          sources: [{ from: 'claude', where: '~/.claude/skills' }],
          home: '~/.claude/skills/impeccable',
          here: { claude: 'in', codex: 'missing', opencode: 'in' },
          roles: ['lead', 'reviewer', 'coordinator'],
          repository: null,
          from: null,
          way: 'command',
          signIn: { claude: 'unknown', codex: 'unknown', opencode: 'unknown' },
          failed: null,
          offIn: [],
        })
        assert.strictEqual(by('write-docs')?.home, '~/.agents/skills/write-docs')
        // A plugin on in Claude Code, by the name Claude Code calls it; one off isn't listed.
        assert.deepInclude(by('superpowers:superpowers-skill'), {
          sources: [{ from: 'plugin', where: 'superpowers' }],
          home: 'the superpowers plugin',
          here: { claude: 'in', codex: 'cant', opencode: 'cant' },
        })
        // Althar's store: given by Althar to every agent, from GitHub at its commit; one off is in no role.
        assert.deepInclude(by('alpha'), {
          about: 'From GitHub.',
          sources: [{ from: 'althar', where: 'Althar’s store' }],
          home: 'Althar’s store',
          here: { claude: 'in', codex: 'in', opencode: 'in' },
          roles: ['lead', 'reviewer', 'coordinator'],
          from: { repo: 'someone/skills', subpath: 'skills/alpha', ref: 'main', sha: 'a'.repeat(40) },
        })
        assert.deepStrictEqual(by('resting')?.roles, [])
        assert.isNull(by('resting')?.from ?? null)
        // In the store and in Claude Code's folder: one, the store's.
        assert.lengthOf(
          rows.filter((one) => one.name === 'shared'),
          1,
        )
        assert.deepInclude(by('shared'), {
          about: 'The store’s own.',
          home: 'Althar’s store',
          sources: [
            { from: 'althar', where: 'Althar’s store' },
            { from: 'claude', where: '~/.claude/skills' },
          ],
        })
        // A repository's own, in every role, which Codex doesn't read from there.
        assert.deepInclude(by('repo-rules'), {
          about: 'How this repository is worked on.',
          sources: [{ from: 'repository', where: REPOSITORY_SKILLS }],
          repository: project.projectId,
          home: `${REPOSITORY_SKILLS}/repo-rules`,
          here: { claude: 'in', codex: 'cant', opencode: 'in' },
          roles: ['lead', 'reviewer', 'coordinator'],
          offIn: [],
        })
        // Listed for its project, and for no other.
        assert.isDefined((yield* agentTools(project.projectId)).skills.find((one) => one.name === 'repo-rules'))
        assert.isUndefined((yield* agentTools('another-project')).skills.find((one) => one.name === 'repo-rules'))
      }),
    ),
  )
})

describe('the roles and projects a skill is given in', () => {
  it.live('turns a store skill off with its last role, records which way it went, and on again with the roles chosen', () =>
    withSetUp(({ store }) =>
      Effect.gen(function* () {
        const off = yield* setSkillRoles({ root: store }, 'alpha', [], null, null)
        assert.deepInclude(off, { id: 'alpha', active: false })
        assert.isFalse((yield* readInstalls(store)).installs.find((one) => one.id === 'alpha')?.active)
        assert.deepStrictEqual((yield* agentTools(null)).skills.find((one) => one.name === 'alpha')?.roles, [])
        const on = yield* setSkillRoles({ root: store }, 'alpha', ['lead'], null, null)
        assert.deepInclude(on, { id: 'alpha', active: true })
        assert.deepStrictEqual((yield* agentTools(null)).skills.find((one) => one.name === 'alpha')?.roles, ['lead'])
        // Already on: only its roles change, and there is nothing to record.
        assert.isUndefined(yield* setSkillRoles({ root: store }, 'alpha', ['lead', 'reviewer'], null, null))
        // Off and on again: every role, not the last roles it had.
        yield* setSkillRoles({ root: store }, 'alpha', [], null, null)
        yield* setSkillRoles({ root: store }, 'alpha', ['lead', 'reviewer', 'coordinator'], null, null)
        assert.deepStrictEqual((yield* agentTools(null)).skills.find((one) => one.name === 'alpha')?.roles, [
          'lead',
          'reviewer',
          'coordinator',
        ])
      }),
    ),
  )

  it.live('refuses in words to turn on a store skill never reviewed', () =>
    withSetUp(({ store }) =>
      Effect.gen(function* () {
        const installs = yield* readInstalls(store)
        const resting = installs.installs.find((one) => one.id === 'resting')!
        yield* writeInstalls(store, withInstall(installs, { ...resting, review: 'not-reviewed' }))
        const refused = yield* setSkillRoles({ root: store }, 'resting', ['lead'], null, null).pipe(Effect.flip)
        assert.strictEqual(refused._tag, 'SkillRefused')
        assert.include(refused.message, "hasn't been reviewed")
        assert.isFalse((yield* readInstalls(store)).installs.find((one) => one.id === 'resting')?.active)
      }),
    ),
  )

  it.live('keeps only roles for one of the agents’ own, and a repository’s own under its project', () =>
    withSetUp(({ store }) =>
      Effect.gen(function* () {
        const { project } = yield* projectWithSkill
        assert.isUndefined(yield* setSkillRoles({ root: store }, 'impeccable', ['reviewer'], null, null))
        assert.isUndefined(yield* setSkillRoles({ root: store }, 'repo-rules', ['lead'], null, project.projectId))
        const rows = (yield* agentTools(project.projectId)).skills
        assert.deepStrictEqual(rows.find((one) => one.name === 'impeccable')?.roles, ['reviewer'])
        assert.deepStrictEqual(rows.find((one) => one.name === 'repo-rules')?.roles, ['lead'])
        const sql = yield* SqlClient.SqlClient
        const [kept] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = 'agent_tools'`
        assert.deepStrictEqual(Object.keys(JSON.parse(kept?.value ?? '{}').skill), ['impeccable', `@${project.projectId}/repo-rules`])
      }),
    ),
  )

  it.live('holds back, per role and per project, what each role isn’t given; a store skill by leaving it out', () =>
    withSetUp(({ store }) =>
      Effect.gen(function* () {
        const { project } = yield* projectWithSkill
        yield* setToolRoles('skill', 'alpha', ['reviewer'], null)
        yield* setToolRoles('skill', 'impeccable', ['coordinator'], null)
        yield* setToolRoles('skill', 'write-docs', ['lead', 'coordinator'], null)
        yield* setSkillRoles({ root: store }, 'repo-rules', ['reviewer'], null, project.projectId)
        yield* setToolInProject('skill', 'superpowers:superpowers-skill', project.projectId, false)
        const lead = yield* heldSkillsFor('lead', project.projectId)
        assert.deepStrictEqual([...lead.names].toSorted(), [
          'alpha',
          'impeccable',
          'repo-rules',
          'resting',
          'superpowers:superpowers-skill',
        ])
        // A store skill is held by leaving it out of Althar's own selection: only what the agent loads itself goes to it.
        assert.deepStrictEqual(lead.agent, [{ name: 'impeccable' }, { name: 'superpowers:superpowers-skill' }, { name: 'repo-rules' }])
        const reviewer = yield* heldSkillsFor('reviewer', project.projectId)
        // Its SKILL.md calls it otherwise: Codex goes by that.
        assert.deepStrictEqual(reviewer.agent, [
          { name: 'impeccable' },
          { name: 'superpowers:superpowers-skill' },
          { name: 'write-docs', called: 'docs-writer' },
        ])
        const coordinator = yield* heldSkillsFor('coordinator', project.projectId)
        assert.deepStrictEqual([...coordinator.names].toSorted(), ['alpha', 'repo-rules', 'resting', 'superpowers:superpowers-skill'])
        // Pressed out in one project only; and another project has no repository skill of this one's.
        assert.deepStrictEqual((yield* heldSkillsFor('coordinator', 'another-project')).agent, [])
      }),
    ),
  )

  it.live('gives a lead only the store skills its role gets, names only those in its brief, and holds the rest in its agent', () =>
    withSetUp(({ store }) =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created, project } = yield* task()
        yield* setSkillRoles({ root: store }, 'alpha', ['reviewer'], null, null)
        yield* setToolRoles('skill', 'impeccable', ['coordinator'], null)
        yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
        const given = yield* until(items(created.threadId), (rows) =>
          rows.some((row) => typeof row.content.text === 'string' && row.content.text.startsWith('echo: You are working')),
        )
        const brief = given
          .map((row) => row.content.text)
          .find((text) => typeof text === 'string' && text.startsWith('echo: You are working'))
        assert.include(brief, 'Althar has given you skills for this task: shared.')
        assert.notInclude(brief, 'alpha')
        assert.deepStrictEqual(sessionMetas.at(-1)?.options?.heldSkills, [{ name: 'impeccable' }])
        // Claude Code's session settings deny it, beside the run's own plugin.
        const asked = sessionsAsked.findLast((one) => one.agentId === 'claude-code')?.params._meta as
          | { claudeCode?: { options?: { settings?: { permissions?: { deny?: Array<string> }; skillOverrides?: unknown } } } }
          | undefined
        assert.include(asked?.claudeCode?.options?.settings?.permissions?.deny ?? [], 'Skill(impeccable)')
        assert.deepStrictEqual(asked?.claudeCode?.options?.settings?.skillOverrides, { impeccable: 'off' })
        yield* sessions.stop(created.threadId)
        // The coordinator gets impeccable, and not alpha, whatever agent it runs.
        yield* sessions.start({ threadId: project.coordinatorThreadId, agentId: 'opencode' })
        assert.isUndefined(launches.at(-1)?.options?.heldSkills)
        const config = JSON.parse(launches.at(-1)?.launched?.OPENCODE_CONFIG_CONTENT ?? '{}') as { permission?: { skill?: unknown } }
        assert.isUndefined(config.permission?.skill)
        yield* sessions.stop(project.coordinatorThreadId)
        // Pressed out of the project: its lead holds it too.
        yield* setToolInProject('skill', 'shared', project.projectId, false)
        yield* sessions.start({ threadId: created.threadId, agentId: 'opencode' })
        assert.deepStrictEqual(launches.at(-1)?.options?.heldSkills, [{ name: 'impeccable' }, { name: 'shared' }])
        const held = JSON.parse(launches.at(-1)?.launched?.OPENCODE_CONFIG_CONTENT ?? '{}') as { permission?: { skill?: unknown } }
        assert.deepStrictEqual(held.permission?.skill, { impeccable: 'deny', shared: 'deny' })
        yield* sessions.stop(created.threadId)
      }),
    ),
  )

  it.live('shows a skill sync linked in as added, and leaves its link as it is when a role holds it back', () =>
    withSetUp(({ home, folder }) =>
      Effect.gen(function* () {
        turnSkillsOn({ homeDir: home, env: {}, folder, now: () => '2026-11-08T10:00:00.000Z' })
        const link = join(home, '.agents', 'skills', 'impeccable')
        assert.isTrue(lstatSync(link).isSymbolicLink())
        const row = (yield* agentTools(null)).skills.find((one) => one.name === 'impeccable')
        assert.deepStrictEqual(row?.here, { claude: 'in', codex: 'added', opencode: 'in' })
        // Still its own folder's, not the link's.
        assert.deepStrictEqual(row?.sources, [{ from: 'claude', where: '~/.claude/skills' }])
        yield* setToolRoles('skill', 'impeccable', ['coordinator'], null)
        assert.deepStrictEqual((yield* heldSkillsFor('lead', 'project-a')).agent, [{ name: 'impeccable' }])
        assert.isTrue(lstatSync(link).isSymbolicLink())
      }),
    ),
  )

  it.live('takes out what was kept of a skill’s roles once it is taken out of the store', () =>
    withSetUp(({ store }) =>
      Effect.gen(function* () {
        yield* setSkillRoles({ root: store }, 'alpha', ['lead'], null, null)
        yield* setToolInProject('skill', 'alpha', 'project-a', false)
        yield* forgetSkillRoles('alpha')
        const sql = yield* SqlClient.SqlClient
        const [kept] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = 'agent_tools'`
        assert.notProperty(JSON.parse(kept?.value ?? '{}').skill, 'alpha')
      }),
    ),
  )
})
