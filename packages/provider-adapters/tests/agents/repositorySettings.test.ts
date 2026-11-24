import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { agents, bundledClaude, type SessionOptions } from '../../src/registry'
import { readRepositorySettings, type SettingsAgent, untrustedOf } from '../../src/repositorySettings'

/*
 * A repository whose agent settings write a file outside its worktree, run by the real agents (DEV-280): nothing of
 * them runs before the person trusts them, they run once trusted, and stop again once a branch changes them. Claude
 * Code runs its SessionStart hook before it reaches its model, so a key that doesn't work is enough; OpenCode loads
 * its plugins as it reads its config. Neither needs a sign-in, and neither spends usage. Each skips where its agent
 * isn't here.
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

const claude = bundledClaude()

describe.skipIf(claude === null)('Claude Code and a repository’s hooks', () => {
  /** Claude Code as its lead's session would start it, by the CLI flags its session options stand for. */
  const run = (worktree: string, home: string, options: SessionOptions) => {
    const meta = agents['claude-code'].sessionMeta?.('lead', options) as {
      claudeCode: { options: { settingSources?: Array<string>; additionalDirectories?: Array<string>; env?: Record<string, string> } }
    }
    const { settingSources, additionalDirectories, env } = meta.claudeCode.options
    spawnSync(
      claude ?? 'claude',
      [
        '-p',
        'hi',
        ...(settingSources === undefined ? [] : ['--setting-sources', settingSources.join(',')]),
        ...(additionalDirectories ?? []).flatMap((folder) => ['--add-dir', folder]),
      ],
      {
        cwd: worktree,
        input: '',
        timeout: 60_000,
        env: {
          ...process.env,
          ...env,
          CLAUDE_CONFIG_DIR: home,
          ANTHROPIC_API_KEY: 'sk-ant-not-a-key',
        },
      },
    )
  }

  it('runs none of them before trust, runs them once trusted, and none again once a branch changes them', async () => {
    const { root, outside, worktree, put } = fixture((outside) => ({
      '.claude/settings.json': JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${join(outside, 'repository-hook')}` }] }] },
      }),
    }))
    const home = join(root, 'home')
    mkdirSync(home)
    // The person's own hook, which runs whatever the repository's are.
    writeFileSync(
      join(home, 'settings.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${join(outside, 'own-hook')}` }] }] } }),
    )
    const ran = async (trusted: ReadonlyArray<{ file: string; hash: string }>) => {
      rmSync(join(outside, 'repository-hook'), { force: true })
      rmSync(join(outside, 'own-hook'), { force: true })
      run(worktree, home, (await optionsFor('claude-code', worktree, trusted)).options)
      return { repository: existsSync(join(outside, 'repository-hook')), own: existsSync(join(outside, 'own-hook')) }
    }
    try {
      expect(await ran([])).toEqual({ repository: false, own: true })
      const trusted = (await optionsFor('claude-code', worktree, [])).files.map(({ file, hash }) => ({ file, hash }))
      expect(await ran(trusted)).toEqual({ repository: true, own: true })
      git(worktree, 'switch', '-qc', 'task')
      put({
        '.claude/settings.json': JSON.stringify({
          hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${join(outside, 'repository-hook')} && echo changed` }] }] },
        }),
      })
      expect(await ran(trusted)).toEqual({ repository: false, own: true })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const opencode = spawnSync('opencode', ['--version'], { encoding: 'utf8' }).status === 0

describe.skipIf(!opencode)('OpenCode and a repository’s plugins', () => {
  it('loads none before trust, loads them once trusted, and none again once a branch changes them', async () => {
    const { root, outside, worktree, put } = fixture((outside) => ({
      '.opencode/plugin/mark.js': `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(outside, 'plugin'))}, 'x')\nexport const Mark = async () => ({})\n`,
    }))
    const ran = async (trusted: ReadonlyArray<{ file: string; hash: string }>) => {
      rmSync(join(outside, 'plugin'), { force: true })
      const { options } = await optionsFor('opencode', worktree, trusted)
      // After a start without the repository's config, OpenCode waits about a minute on its own setup before it loads it.
      spawnSync('opencode', ['debug', 'config'], {
        cwd: worktree,
        input: '',
        timeout: 150_000,
        env: {
          ...process.env,
          ...agents.opencode.sessionEnv?.({}, options),
          XDG_CONFIG_HOME: join(root, 'c'),
          XDG_DATA_HOME: join(root, 'd'),
          XDG_STATE_HOME: join(root, 's'),
          XDG_CACHE_HOME: join(root, 'k'),
        },
      })
      return existsSync(join(outside, 'plugin'))
    }
    try {
      expect(await ran([])).toBe(false)
      const trusted = (await optionsFor('opencode', worktree, [])).files.map(({ file, hash }) => ({ file, hash }))
      expect(await ran(trusted)).toBe(true)
      git(worktree, 'switch', '-qc', 'task')
      put({
        '.opencode/plugin/mark.js': `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(outside, 'plugin'))}, 'changed')\nexport const Mark = async () => ({})\n`,
      })
      expect(await ran(trusted)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 400_000)
})

describe('Codex and a repository’s hooks', () => {
  it('says it loads them whatever the person decided, so its sessions start as they always do', async () => {
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
