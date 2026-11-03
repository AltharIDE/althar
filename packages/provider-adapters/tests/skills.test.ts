import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
    // Where XDG_CONFIG_HOME says, as OpenCode takes it; a Flatpak's own, for a copy that runs inside.
    assert.isTrue(agents.opencode.skillFolders?.({ env: { XDG_CONFIG_HOME: '/x' }, homeDir: home, cwd }).includes('/x/opencode/skills'))
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
