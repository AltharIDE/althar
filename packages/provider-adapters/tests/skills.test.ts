import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type * as acp from '@agentclientprotocol/sdk'
import { assert, describe, it } from '@effect/vitest'

import { normalize } from '../src/events'
import { childEnvironment } from '../src/process'
import { agents } from '../src/registry'
import { skillsIn } from '../src/skills'

/*
 * The person's skills passed through to each agent (DEV-188), up to what
 * Althar decides. Each update below is what the real agent sent, read on
 * 3 November 2026 (src/skills.ts says which versions), paths aside; that the
 * agents themselves find the skills is `tests/agents/skills.test.ts`.
 */

const update = (raw: unknown) => normalize(raw as acp.SessionUpdate)

/** An adapter tells an AIR client, as Althar is, each skill's file in its command's `_meta`. */
const air = (fields: object) => ({ jetbrains: { air: { version: 1, ...fields } } })

const skill = (root: string, name: string) => {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: A fixture.\n---\n\nIts words.\n`)
}

describe('what an agent could see', () => {
  it('is what Claude Code says: the skills among its commands, with their files, and not its built-in commands', () => {
    assert.deepStrictEqual(
      update({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'mine', description: 'A fixture', _meta: air({ kind: 'skill', skillPath: '/h/.claude/skills/mine/SKILL.md' }) },
          { name: 'ours', description: 'A fixture', _meta: air({ kind: 'skill', skillPath: '/r/.claude/skills/ours/SKILL.md' }) },
          { name: 'compact', description: 'Compact' },
          // Bundled with its CLI: a skill, but no file of the person's or the repository's.
          { name: 'simplify', description: 'Simplify', _meta: air({ kind: 'skill' }) },
        ],
      }),
      {
        _tag: 'SkillsSeen',
        skills: [
          { name: 'mine', path: '/h/.claude/skills/mine/SKILL.md' },
          { name: 'ours', path: '/r/.claude/skills/ours/SKILL.md' },
        ],
      },
    )
  })

  it('is what Codex says, without its `$` or the skills it unpacks for itself', () => {
    assert.deepStrictEqual(
      update({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'plan', description: 'Plan', _meta: air({ commandAction: { kind: 'setConfigOption' } }) },
          { name: '$ours', description: 'A fixture', _meta: air({ skillPath: '/r/.agents/skills/ours/SKILL.md' }) },
          { name: '$mine', description: 'A fixture', _meta: air({ skillPath: '/h/.agents/skills/mine/SKILL.md' }) },
          { name: '$old', description: 'A fixture', _meta: air({ skillPath: '/h/.codex/skills/old/SKILL.md' }) },
          { name: '$imagegen', description: 'Images', _meta: air({ skillPath: '/h/.codex/skills/.system/imagegen/SKILL.md' }) },
        ],
      }),
      {
        _tag: 'SkillsSeen',
        skills: [
          { name: 'ours', path: '/r/.agents/skills/ours/SKILL.md' },
          { name: 'mine', path: '/h/.agents/skills/mine/SKILL.md' },
          { name: 'old', path: '/h/.codex/skills/old/SKILL.md' },
        ],
      },
    )
  })

  it("says nothing where an agent's commands don't say which are skills, as OpenCode's don't", () => {
    for (const availableCommands of [
      [
        { name: 'person-opencode', description: 'A fixture' },
        { name: 'init', description: 'Init' },
      ],
      [],
    ])
      assert.strictEqual(update({ sessionUpdate: 'available_commands_update', availableCommands })._tag, 'Other')
  })

  it("finds OpenCode's in the folders it reads: the person's, its config home's among them, and the repository's up to its root", () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-skills-home-'))
    const repository = mkdtempSync(join(tmpdir(), 'althar-skills-repository-'))
    mkdirSync(join(repository, '.git'))
    const cwd = join(repository, 'packages', 'app')
    mkdirSync(cwd, { recursive: true })
    skill(join(home, '.config', 'opencode', 'skills'), 'config-home')
    skill(join(home, '.claude', 'skills'), 'person-claude')
    skill(join(home, '.agents', 'skills'), 'person-agents')
    skill(join(repository, '.opencode', 'skills'), 'repo-opencode')
    skill(join(repository, '.claude', 'skills'), 'repo-claude')
    skill(join(repository, '.agents', 'skills'), 'repo-agents')
    skill(join(cwd, '.agents', 'skills'), 'nested')

    const folders = agents.opencode.skillFolders?.({ env: {}, homeDir: home, cwd }) ?? []
    assert.deepStrictEqual(
      skillsIn(folders)
        .map(({ name }) => name)
        .toSorted(),
      ['config-home', 'nested', 'person-agents', 'person-claude', 'repo-agents', 'repo-claude', 'repo-opencode'],
    )
    // Where XDG_CONFIG_HOME says, as OpenCode takes it.
    assert.isTrue(agents.opencode.skillFolders?.({ env: { XDG_CONFIG_HOME: '/x' }, homeDir: home, cwd }).includes('/x/opencode/skills'))
  })

  it("names the person's config folder to an OpenCode inside a Flatpak, whose config home is the app's", () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-skills-home-'))
    skill(join(home, '.config', 'opencode', 'skills'), 'person-opencode')
    const env = { XDG_CONFIG_HOME: join(home, 'app-config') }
    const skillsConfig = (inSandbox: boolean) =>
      JSON.parse(agents.opencode.withoutOwnTools?.({ env, homeDir: home, cwd: home, inSandbox }).OPENCODE_CONFIG_CONTENT ?? '{}').skills
    const shown = (inSandbox: boolean) =>
      skillsIn(agents.opencode.skillFolders?.({ env, homeDir: home, cwd: home, inSandbox }) ?? []).map(({ name }) => name)
    assert.deepStrictEqual(skillsConfig(true), { paths: [join(home, '.config', 'opencode', 'skills')] })
    assert.deepStrictEqual(shown(true), ['person-opencode'])
    // Out on the device it reads that folder itself, and may be a version that refuses the setting.
    assert.isUndefined(skillsConfig(false))
    assert.deepStrictEqual(shown(false), [])
  })

  it('keeps that setting through what a session and a review change of its config', () => {
    const own = agents.opencode.withoutOwnTools?.({ env: {}, homeDir: '/h', cwd: '/h', inSandbox: true }) ?? {}
    const paths = { paths: ['/h/.config/opencode/skills'] }
    assert.deepStrictEqual(JSON.parse(agents.opencode.reviewing?.env?.(own).OPENCODE_CONFIG_CONTENT ?? '{}').skills, paths)
    assert.deepStrictEqual(JSON.parse(agents.opencode.sessionEnv?.(own, { web: false }).OPENCODE_CONFIG_CONTENT ?? '{}').skills, paths)
  })

  it('reads a skill by the name in its frontmatter, and leaves out what an agent would', () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-skills-'))
    skill(root, 'plain')
    mkdirSync(join(root, 'folder-name'))
    writeFileSync(join(root, 'folder-name', 'SKILL.md'), '---\ndescription: d\nname: "its-name"\n---\n')
    mkdirSync(join(root, 'no-frontmatter'))
    writeFileSync(join(root, 'no-frontmatter', 'SKILL.md'), '# Just words\nname: not-this\n')
    mkdirSync(join(root, 'empty'))
    writeFileSync(join(root, 'a-file.md'), 'not a skill')
    assert.deepStrictEqual(
      skillsIn([root, join(root, 'not-there')])
        .map(({ name }) => name)
        .toSorted(),
      ['its-name', 'plain'],
    )
  })

  it.runIf(process.platform !== 'win32')("isn't held up by what a checkout puts where a `SKILL.md` goes", () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-skills-'))
    for (const name of ['to-a-device', 'a-pipe', 'to-a-pipe', 'a-folder']) mkdirSync(join(root, name))
    symlinkSync('/dev/zero', join(root, 'to-a-device', 'SKILL.md'))
    execFileSync('mkfifo', [join(root, 'a-pipe', 'SKILL.md')])
    symlinkSync(join(root, 'a-pipe', 'SKILL.md'), join(root, 'to-a-pipe', 'SKILL.md'))
    mkdirSync(join(root, 'a-folder', 'SKILL.md'))
    skill(root, 'plain')
    assert.deepStrictEqual(
      skillsIn([root]).map(({ name }) => name),
      ['plain'],
    )
  })

  it.runIf(process.platform !== 'win32')('reads only the top of a `SKILL.md`, however big, and takes a link to one', () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-skills-'))
    mkdirSync(join(root, 'huge'))
    const huge = join(root, 'huge', 'SKILL.md')
    writeFileSync(huge, '---\nname: huge\n---\n')
    truncateSync(huge, 3 * 1024 ** 3)
    mkdirSync(join(root, 'late'))
    writeFileSync(join(root, 'late', 'SKILL.md'), `---\ndescription: ${'x'.repeat(1024 ** 2)}\nname: late\n---\n`)
    // How a dotfiles manager keeps a person's skills.
    skill(join(root, 'kept'), 'linked')
    mkdirSync(join(root, 'linked'))
    symlinkSync(join(root, 'kept', 'linked', 'SKILL.md'), join(root, 'linked', 'SKILL.md'))
    assert.deepStrictEqual(
      skillsIn([root])
        .map(({ name, path }) => ({ name, path }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
      [
        { name: 'huge', path: huge },
        { name: 'linked', path: join(root, 'linked', 'SKILL.md') },
      ],
    )
  })

  it("doesn't slow on a frontmatter line made to", () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-skills-'))
    mkdirSync(join(root, 'spaces'))
    writeFileSync(join(root, 'spaces', 'SKILL.md'), `---\nname: a${' '.repeat(60_000)}b\n---\n`)
    assert.lengthOf(skillsIn([root]), 1)
  })
})

describe('when an agent loads a skill', () => {
  it('is what Claude Code says on its call', () => {
    const first = update({
      sessionUpdate: 'tool_call',
      toolCallId: 't',
      title: 'Load skill',
      kind: 'other',
      status: 'pending',
      content: [],
      _meta: { claudeCode: { toolName: 'Skill' } },
    })
    assert.isFalse('skill' in first)
    assert.deepInclude(
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't',
        title: 'Load skill: mine',
        rawInput: { skill: 'mine' },
        _meta: air({ skill: { name: 'mine', path: '/h/.claude/skills/mine/SKILL.md' } }),
      }),
      { skill: 'mine' },
    )
  })

  it('is what OpenCode says: `name` and a title in 1.x, `id` in 2.x', () => {
    for (const input of [{ name: 'mine' }, { id: 'mine' }])
      assert.deepInclude(
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 't',
          title: 'skill',
          kind: 'other',
          status: 'in_progress',
          rawInput: input,
        }),
        { skill: 'mine' },
      )
    assert.deepInclude(update({ sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'Loaded skill: mine', status: 'completed' }), {
      skill: 'mine',
    })
    assert.isFalse(
      'skill' in update({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'skill', kind: 'other', status: 'pending', rawInput: {} }),
    )
  })

  it("isn't said by Codex, whose calls are reads like any other", () => {
    const read = update({
      sessionUpdate: 'tool_call',
      toolCallId: 't',
      title: "Read file '/h/.agents/skills/mine/SKILL.md'",
      kind: 'read',
      status: 'completed',
      locations: [{ path: '/h/.agents/skills/mine/SKILL.md' }],
    })
    assert.isFalse('skill' in read)
  })
})

describe("where each agent's skills reach it", () => {
  it("shares the person's `skills` folder into a Claude Code or Codex home Althar makes", () => {
    for (const id of ['claude-code', 'codex'] as const) assert.include(agents[id].home.shared(['skills', 'auth.json']), 'skills')
  })

  it("leaves OpenCode's config home the person's: only its data folder is an account's", () => {
    assert.strictEqual(agents.opencode.home.variable, 'XDG_DATA_HOME')
    assert.isUndefined(agents.opencode.launch('node').env?.XDG_CONFIG_HOME)
  })

  it("lets each agent's process find the person's home folder and config home", () => {
    for (const id of ['claude-code', 'codex', 'opencode'] as const)
      assert.deepInclude(childEnvironment(agents[id].launch('node'), { HOME: '/h', XDG_CONFIG_HOME: '/h/.config' }, false), {
        HOME: '/h',
        XDG_CONFIG_HOME: '/h/.config',
      })
  })
})
