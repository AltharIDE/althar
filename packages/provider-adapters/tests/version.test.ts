import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import { agents } from '../src/registry'
import { agentVersion, majorOf, unsupportedAt, unsupportedNow, versionIn } from '../src/version'

describe('an agent’s version', () => {
  it('reads the number each CLI prints', () => {
    expect(versionIn('2.1.263 (Claude Code)')).toBe('2.1.263')
    expect(versionIn('codex-cli 0.159.3')).toBe('0.159.3')
    expect(versionIn('1.18')).toBe('1.18')
    expect(versionIn('no version here')).toBeNull()
  })

  it('asks the agent, and has none where it can’t say or has no way to', async () => {
    const said = { ...agents.opencode, version: () => ({ command: 'bun', args: ['-e', 'console.log("1.18.31")'] }) }
    const failing = { ...agents.opencode, version: () => ({ command: 'althar-no-such-cli', args: [] }) }
    const { version: _, ...without } = agents.opencode
    expect(await Effect.runPromise(agentVersion(said))).toBe('1.18.31')
    expect(await Effect.runPromise(agentVersion(failing))).toBeNull()
    expect(await Effect.runPromise(agentVersion(without))).toBeNull()
  })

  it('reads a version’s major', () => {
    expect(majorOf('2.0.29')).toBe(2)
    expect(majorOf('1.19')).toBe(1)
    expect(majorOf('v2.0.29')).toBeNull()
    expect(majorOf('nightly')).toBeNull()
  })
})

describe('the major Althar runs an agent at', () => {
  const why = agents.opencode.supported?.why ?? ''
  const saying = (printed: string) => ({
    ...agents.opencode,
    version: () => ({ command: 'bun', args: ['-e', `console.log(${JSON.stringify(printed)})`] }),
  })

  it('holds OpenCode to 1.x, saying why in Settings’ words', () => {
    expect(agents.opencode.supported?.major).toBe(1)
    expect(why).toContain('OpenCode 2 isn’t supported yet')
    expect(why).toContain('MCP servers')
    expect(unsupportedAt(agents.opencode, '1.19.0')).toBeNull()
    expect(unsupportedAt(agents.opencode, '2.0.29')).toBe(why)
    expect(unsupportedAt(agents.opencode, '0.9.1')).toBe(why)
  })

  it('stops nothing where the version can’t be read, or the agent runs at any', () => {
    expect(unsupportedAt(agents.opencode, null)).toBeNull()
    expect(unsupportedAt(agents.opencode, 'nightly')).toBeNull()
    expect(unsupportedAt(agents['claude-code'], '3.0.0')).toBeNull()
  })

  it('asks the copy the agent runs now, as OpenCode 2 prints it', async () => {
    expect(await Effect.runPromise(unsupportedNow(saying('opencode v2.0.29')))).toBe(why)
    expect(await Effect.runPromise(unsupportedNow(saying('1.19.0')))).toBeNull()
    expect(
      await Effect.runPromise(unsupportedNow({ ...agents.opencode, version: () => ({ command: 'althar-no-such-cli', args: [] }) })),
    ).toBeNull()
  })
})
