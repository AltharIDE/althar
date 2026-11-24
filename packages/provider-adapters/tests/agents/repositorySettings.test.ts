import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { Effect, Stream } from 'effect'

import { connect } from '../../src/AgentConnection'
import { agents, bundledClaude, type SessionOptions } from '../../src/registry'
import { readRepositorySettings, type SettingsAgent, untrustedOf } from '../../src/repositorySettings'

/*
 * A repository whose agent settings write a file outside its worktree, run by the real agents through their ACP
 * adapters, as a lead's session starts them (DEV-280): its `session/new` with the session settings and environment
 * Althar gives it. Nothing of them runs before the person trusts them, they run once trusted, and stop again once a
 * branch changes them. Claude Code runs its hooks as its session starts and as a message is sent, before it reaches its
 * model, so a key that doesn't work is enough; OpenCode loads its plugins as its session starts. Neither needs a
 * sign-in, and neither spends usage. Codex asks for a sign-in before it runs anything, so it isn't run here: its test
 * checks only that it says it loads them and is started as ever. Each skips where its agent isn't here.
 */

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync('git', [...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  })

/** A repository with `files`, committed on main; and the folder outside it its settings write to. */
const fixture = (files: (outside: string) => Readonly<Record<string, string>>) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-trust-'))
  const outside = join(root, 'outside')
  const worktree = join(root, 'repo')
  mkdirSync(outside)
  mkdirSync(worktree)
  git(worktree, 'init', '-q', '-b', 'main')
  const put = (more: Readonly<Record<string, string>>) => {
    for (const [path, text] of Object.entries(more)) {
      mkdirSync(join(worktree, path, '..'), { recursive: true })
      writeFileSync(join(worktree, path), text)
    }
    git(worktree, 'add', '-A')
    git(worktree, 'commit', '-qm', 'settings')
  }
  put(files(outside))
  return { root, outside, worktree, put }
}

/** How a lead's session is started, as the runtime decides it: without the repository's settings where one isn't trusted. */
const optionsFor = async (agent: SettingsAgent, worktree: string, trusted: ReadonlyArray<{ file: string; hash: string }>) => {
  const files = (await readRepositorySettings(worktree)).filter((file) => file.agent === agent)
  const options: SessionOptions =
    untrustedOf(files, trusted).length === 0 || agents[agent].untrustedRepositories !== undefined
      ? {}
      : { withoutRepositorySettings: { folders: [worktree] } }
  return { options, files }
}

/**
 * A lead's session of `agent` in `worktree`, through its ACP adapter, as Althar starts it: its environment, its
 * session's settings, `session/new`; with a message sent where `prompt`, then a wait for what it runs to have run.
 */
const session = (agent: SettingsAgent, worktree: string, env: Readonly<Record<string, string>>, options: SessionOptions, prompt: boolean) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const definition = agents[agent]
        const spec = definition.launch(process.execPath)
        const connection = yield* connect({
          transport: {
            _tag: 'Process',
            cwd: worktree,
            spec: { ...spec, env: { ...spec.env, ...env, ...definition.sessionEnv?.({ ...spec.env, ...env }, options) } },
          },
          permissions: definition.permissions,
          onPermission: () => Effect.succeed({ decision: 'reject' as const, reason: 'This test permits nothing.' }),
        })
        const started = yield* connection.newSession({
          cwd: worktree,
          mode: definition.modes.ask,
          modeOptionId: definition.options.mode,
          ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
        })
        // A key that doesn't work fails the turn once its hooks have run.
        if (prompt) yield* Effect.ignore(Stream.runDrain(started.prompt('hi')).pipe(Effect.timeout('60 seconds')))
        yield* Effect.sleep(prompt ? '2 seconds' : '20 seconds')
      }),
    ),
  )

describe.skipIf(bundledClaude() === null)('Claude Code and a repository’s hooks, through claude-agent-acp', () => {
  it('runs none of them before trust, runs them once trusted, and none again once a branch changes them, the person’s own always', async () => {
    const hook = (outside: string, name: string, more = '') => ({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: `touch ${join(outside, `${name}-start`)}${more}` }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: `touch ${join(outside, `${name}-prompt`)}${more}` }] }],
      },
    })
    const { root, outside, worktree, put } = fixture((outside) => ({
      '.claude/settings.json': JSON.stringify(hook(outside, 'repository')),
    }))
    const home = join(root, 'home')
    mkdirSync(home)
    // The person's own hooks, which run whatever the repository's do.
    writeFileSync(join(home, 'settings.json'), JSON.stringify(hook(outside, 'own')))
    const ran = async (trusted: ReadonlyArray<{ file: string; hash: string }>) => {
      for (const name of ['repository-start', 'repository-prompt', 'own-start', 'own-prompt']) rmSync(join(outside, name), { force: true })
      const { options } = await optionsFor('claude-code', worktree, trusted)
      await session('claude-code', worktree, { CLAUDE_CONFIG_DIR: home, ANTHROPIC_API_KEY: 'sk-ant-not-a-key' }, options, true)
      // Each hook apart: as its session starts, and as a message is sent.
      const fired = (name: string) => existsSync(join(outside, name))
      return {
        repositoryStart: fired('repository-start'),
        repositoryPrompt: fired('repository-prompt'),
        ownStart: fired('own-start'),
        ownPrompt: fired('own-prompt'),
      }
    }
    const held = { repositoryStart: false, repositoryPrompt: false, ownStart: true, ownPrompt: true }
    try {
      expect(await ran([])).toEqual(held)
      const trusted = (await optionsFor('claude-code', worktree, [])).files.map(({ file, hash }) => ({ file, hash }))
      expect(await ran(trusted)).toEqual({ repositoryStart: true, repositoryPrompt: true, ownStart: true, ownPrompt: true })
      git(worktree, 'switch', '-qc', 'task')
      put({ '.claude/settings.json': JSON.stringify(hook(outside, 'repository', ' && echo changed')) })
      expect(await ran(trusted)).toEqual(held)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const opencode = spawnSync('opencode', ['--version'], { encoding: 'utf8' }).status === 0

describe.skipIf(!opencode)('OpenCode and a repository’s plugins, through opencode acp', () => {
  it('loads none before trust, loads them once trusted, and none again once a branch changes them', async () => {
    const plugin = (outside: string, text: string) =>
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(outside, 'plugin'))}, ${JSON.stringify(text)})\nexport const Mark = async () => ({})\n`
    const { root, outside, worktree, put } = fixture((outside) => ({ '.opencode/plugin/mark.js': plugin(outside, 'x') }))
    const ran = async (trusted: ReadonlyArray<{ file: string; hash: string }>) => {
      rmSync(join(outside, 'plugin'), { force: true })
      const { options } = await optionsFor('opencode', worktree, trusted)
      await session(
        'opencode',
        worktree,
        {
          XDG_CONFIG_HOME: join(root, 'c'),
          XDG_DATA_HOME: join(root, 'd'),
          XDG_STATE_HOME: join(root, 's'),
          XDG_CACHE_HOME: join(root, 'k'),
        },
        options,
        false,
      )
      return existsSync(join(outside, 'plugin'))
    }
    try {
      expect(await ran([])).toBe(false)
      const trusted = (await optionsFor('opencode', worktree, [])).files.map(({ file, hash }) => ({ file, hash }))
      expect(await ran(trusted)).toBe(true)
      git(worktree, 'switch', '-qc', 'task')
      put({ '.opencode/plugin/mark.js': plugin(outside, 'changed') })
      expect(await ran(trusted)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 400_000)
})

describe('Codex and a repository’s hooks', () => {
  // Not run: Codex asks for a sign-in before it runs anything of the repository's, so this checks only what Althar does.
  it('says it loads them whatever the person decided, and is started as ever', async () => {
    const { root, worktree } = fixture(() => ({
      '.codex/hooks.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'touch x' }] }] } }),
    }))
    try {
      expect(agents.codex.untrustedRepositories).toBe('loads')
      const { options, files } = await optionsFor('codex', worktree, [])
      expect(files.map(({ file }) => file)).toEqual(['.codex/hooks.json'])
      expect(options).toEqual({})
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
