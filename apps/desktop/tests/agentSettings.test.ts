import { describe, expect, it } from 'vitest'

import type { AgentSettingsFile } from '@althar/contracts'

import { decidedOf, trustFileOf } from '../src/renderer/features/repositoryTrust/useAgentSettings'

const file = (more: Partial<AgentSettingsFile> = {}): AgentSettingsFile => ({
  agent: 'claude-code',
  agentName: 'Claude Code',
  file: '.claude/settings.json',
  hash: 'h1',
  runs: [{ file: '.claude/settings.json', key: 'hooks.Stop[0].hooks[0]', when: 'When it stops', command: './notify.sh' }],
  trusted: null,
  changed: false,
  loadsAnyway: false,
  ...more,
})

describe('what was decided of a repository’s agent settings', () => {
  it('is trusted only where every file is, changed where one not decided changed since, then undecided, else declined', () => {
    expect(decidedOf([file({ trusted: true }), file({ trusted: true })])).toBe('trusted')
    expect(decidedOf([file({ trusted: true }), file({ trusted: null, changed: true })])).toBe('changed')
    expect(decidedOf([file({ trusted: false }), file({ trusted: null })])).toBe('undecided')
    expect(decidedOf([file({ trusted: false }), file({ trusted: true })])).toBe('declined')
  })

  it('shows a file as the kit does, saying its agent loads it anyway only where it does', () => {
    expect(trustFileOf(file())).toEqual({
      agent: 'claude-code',
      agentName: 'Claude Code',
      file: '.claude/settings.json',
      runs: file().runs,
    })
    expect(trustFileOf(file({ agent: 'codex', agentName: 'Codex', loadsAnyway: true }))).toMatchObject({
      agent: 'codex',
      loadsAnyway: true,
    })
  })
})
