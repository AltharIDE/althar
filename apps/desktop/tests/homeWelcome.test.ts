import { describe, expect, it } from 'vitest'

import type { AgentStatus, Machine, Status } from '@althar/contracts'

import { sshArguments } from '@althar/transport-node'

import type { RemoteHome } from '../src/homes'
import { updateOf, USUAL_LAUNCHER } from '../src/renderer/features/homes/useHomes'
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

  it('never ticks an agent whose sign-in couldn’t be read: it’s unchecked, not ready', () => {
    expect(needsOf(status([{ ...claude, problem: null, signIn: 'unknown' }]), null, null)).toEqual([
      expect.objectContaining({ id: 'claude-code', state: 'unchecked', why: 'Sign-in not checked' }),
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

describe('an older home’s update command', () => {
  const homeId = `home_${'1'.repeat(32)}`
  const over = (ssh: Extract<RemoteHome, { ssh: unknown }>['ssh']) => ({
    kind: 'ssh' as const,
    home: { id: 'h1', name: 'runner-1', homeId, ssh },
  })
  /** What the connection runs on the home, as sshArguments has it. */
  const runs = (ssh: Extract<RemoteHome, { ssh: unknown }>['ssh']) => sshArguments(ssh, homeId).at(-1) ?? ''

  it('runs the launcher the connection runs, where Althar installs one: the very installation the window talks to', () => {
    const update = updateOf(over({ target: 'althar@runner-1' }))
    expect(update).toEqual({ command: `sh ${USUAL_LAUNCHER} update --apply --wait`, installed: 'known' })
    expect(runs({ target: 'althar@runner-1' })).toContain(USUAL_LAUNCHER)
  })

  it('runs a launcher and profile saved for the home, as the connection does, quoted for the shell', () => {
    const ssh = { target: 'althar@runner-1', launcher: "/opt/althar's/launcher", profile: '/srv/althar host' }
    const update = updateOf(over(ssh))
    expect(update).toEqual({
      command: `sh '/opt/althar'\\''s/launcher' update --apply --wait --profile '/srv/althar host'`,
      installed: 'custom',
    })
    // The same words for the launcher and the profile as the connection's.
    expect(runs(ssh)).toContain("'\\''/opt/althar'\\''\\'\\'''\\''s/launcher'\\''")
  })

  it('can’t tell how a paired home was installed, nor one not read yet: where Althar installs one, said as unsure', () => {
    const paired = { kind: 'https' as const, home: { id: 'h2', name: 'runner-2', homeId, https: { origin: 'https://runner-2.example' } } }
    expect(updateOf(paired as never)).toEqual({ command: `sh ${USUAL_LAUNCHER} update --apply --wait`, installed: 'unknown' })
    expect(updateOf(undefined).installed).toBe('unknown')
  })
})
