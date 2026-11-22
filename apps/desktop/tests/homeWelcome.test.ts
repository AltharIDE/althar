import { describe, expect, it } from 'vitest'

import type { AgentStatus, Machine, Status } from '@althar/contracts'

import { needsOf, pastedRepository } from '../src/renderer/features/start/useHomeWelcome'
import { agents, connectionList, githubConnection } from './fixtures'

/* What an empty home's welcome reads from the home: what work there needs, and a repository's address pasted. */

const status = (list: ReadonlyArray<AgentStatus>): Status => ({ apiVersion: 1, appVersion: 'fixture', agents: list })
const MACHINE: Machine = { system: 'Ubuntu 24.04.1 LTS', cores: 8, memory: 32 * 1024 ** 3, disk: null, git: '2.43.0' }
const [claude, codex] = agents as [AgentStatus, AgentStatus]

describe('what work on a home needs', () => {
  it('is nothing until its agents are read', () => {
    expect(needsOf(null, MACHINE, null)).toBeNull()
  })

  it('lists its agents, git and the code hosts it’s connected to, what isn’t ready first', () => {
    const needs = needsOf(status([claude, { ...codex, signIn: 'signed_out' }]), MACHINE, {
      ...connectionList,
      connections: [githubConnection],
    })
    expect(needs?.map((one) => [one.name, one.state])).toEqual([
      ['Codex', 'signedOut'],
      ['Claude Code', 'ready'],
      ['git', 'ready'],
      ['GitHub', 'ready'],
    ])
    expect(needs?.[0]).toMatchObject({ command: 'codex login' })
    expect(needs?.find((one) => one.id === githubConnection.id)).toMatchObject({ note: 'as you' })
  })

  it('says how to install agents where none is, and git where there’s none', () => {
    const away = (agent: AgentStatus, guide: string): AgentStatus => ({ ...agent, installed: false, guide })
    const needs = needsOf(
      status([away(claude, 'https://example.com/claude'), away(codex, 'https://example.com/codex')]),
      { ...MACHINE, git: null },
      null,
    )
    expect(needs?.map((one) => [one.id, one.state])).toEqual([
      ['claude-code', 'missing'],
      ['codex', 'missing'],
      ['git', 'missing'],
    ])
    expect(needs?.[0]).toMatchObject({ guide: 'https://example.com/claude' })
  })

  it('says why an agent couldn’t be checked', () => {
    expect(needsOf(status([{ ...claude, problem: 'It didn’t answer.' }]), null, null)).toEqual([
      expect.objectContaining({ id: 'claude-code', state: 'unchecked', why: 'It didn’t answer.' }),
    ])
  })
})

describe('a repository’s address pasted on the welcome', () => {
  it('is a web or SSH address with an owner and a name', () => {
    expect(pastedRepository('https://github.com/acme/site')).toEqual({ host: 'github.com', path: 'acme/site' })
    expect(pastedRepository(' git@gitlab.com:acme/infra/api.git ')).toEqual({ host: 'gitlab.com', path: 'acme/infra/api' })
  })

  it('is never words that happen to have a colon, or an address with no repository', () => {
    expect(pastedRepository('todo: fix/this')).toBeNull()
    expect(pastedRepository('https://github.com/acme')).toBeNull()
    expect(pastedRepository('meeting notes')).toBeNull()
  })
})
