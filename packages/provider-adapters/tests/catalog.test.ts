import { describe, expect, it } from 'vitest'

import { ACP_PROFILES, externalDefinition, registryCommand, registryIn, type AcpConnection } from '../src/catalog'

const manifest = (distribution: unknown, more = {}) => ({ id: 'example', name: 'Example', version: '1.2.3', distribution, ...more })
const read = (distribution: unknown) => registryIn({ agents: [manifest(distribution)] })[0]!

describe('ACP registry discovery', () => {
  it('reads both supported index shapes, and rejects duplicate or malformed identifiers', () => {
    expect(registryIn([manifest({ npx: { package: 'example@1.2.3' } })])).toHaveLength(1)
    expect(() => registryIn({ agents: [manifest({}), manifest({})] })).toThrow('duplicate')
    expect(() => registryIn([manifest({}, { id: '../../program' })])).toThrow()
    expect(() => registryIn({ agents: 'not an index' })).toThrow()
    expect(() => registryIn([manifest({ npx: { package: '--bad' } }, { name: '' })])).toThrow()
  })

  it('pins an npm launch and preserves arguments without passing them through a shell', () => {
    const agent = read({ npx: { package: '@vendor/example@1.2.3', args: ['--acp', 'a space', '$(never-run)'] } })
    expect(registryCommand(agent)).toEqual({
      command: 'npx',
      args: ['--yes', '@vendor/example@1.2.3', '--acp', 'a space', '$(never-run)'],
      env: {},
    })
    expect(() => registryCommand(read({ npx: { package: 'example@latest' } }))).toThrow('exact version')
    expect(() => registryCommand(read({ npx: { package: 'example@1.2.2' } }))).toThrow('exact version')
  })

  it('pins Python distributions and resolves a binary for the device, without running or downloading one', () => {
    expect(registryCommand(read({ uvx: { package: 'example==1.2.3', args: ['acp'] } }))).toEqual({
      command: 'uvx',
      args: ['example==1.2.3', 'acp'],
      env: {},
    })
    expect(() => registryCommand(read({ uvx: { package: 'example' } }))).toThrow('exact version')
    const agent = read({
      binary: { 'darwin-aarch64': { cmd: './dist/bin/example', args: ['acp'] }, 'windows-x86_64': { cmd: '.\\bin\\example.exe' } },
    })
    expect(registryCommand(agent, 'darwin', 'arm64')).toEqual({ command: 'example', args: ['acp'], env: {} })
    expect(registryCommand(agent, 'win32', 'x64')).toEqual({ command: 'example.exe', args: [], env: {} })
    expect(registryCommand(agent, 'linux', 'x64')).toBeNull()
  })
})

describe('external ACP connections', () => {
  const connection: AcpConnection = {
    id: 'acp-example',
    name: 'Example',
    command: '/tools/example',
    args: ['acp'],
    mode: 'ask',
    readerMode: 'read',
    modeOption: 'approval',
    modelOption: 'model',
    effortOption: 'effort',
    held: { allow_all: 'false' },
    registryId: null,
    registryVersion: null,
  }
  it('preserves the held configuration and never grants account isolation, a permission judge or implicit scopes', () => {
    const agent = externalDefinition(connection)
    expect(agent.launch('node')).toEqual({ command: '/tools/example', args: ['acp'] })
    expect(agent.modes).toEqual({ ask: 'ask', readOnly: 'read', reader: 'read' })
    expect(agent.options).toEqual({ mode: 'approval', model: 'model', effort: 'effort', held: { allow_all: 'false' } })
    expect(agent.home.accounts).toBe('one')
    expect(agent.permissions.allowScopes).toEqual({})
    expect(agent.permissionJudge).toBeUndefined()
    expect(agent.skills).toBeNull()
    expect(agent.commands).toBe('althar')
    expect(externalDefinition({ ...connection, effortOption: null }).options.effort).toBeUndefined()
  })

  it('has setup profiles for every harness in the two requested groups', () => {
    expect(ACP_PROFILES.map((profile) => profile.id)).toEqual([
      'cursor',
      'gemini',
      'goose',
      'pi-acp',
      'omp',
      'kiro',
      'muse-code',
      'cline',
      'kilo',
      'mastracode',
      'hermes',
      'letta',
    ])
    expect(new Set(ACP_PROFILES.map((profile) => profile.id)).size).toBe(12)
  })
})
