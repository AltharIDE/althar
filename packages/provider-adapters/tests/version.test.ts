import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import { agents } from '../src/registry'
import { agentVersion, versionIn } from '../src/version'

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

  it('asks it with its own environment, as an npm-installed one found off the PATH finds its Node by it', async () => {
    const own = {
      ...agents.opencode,
      version: () => ({ command: 'sh', args: ['-c', 'echo "$ALTHAR_TEST_SAYS"'], env: { ALTHAR_TEST_SAYS: '2.0.1' } }),
    }
    expect(await Effect.runPromise(agentVersion(own))).toBe('2.0.1')
  })
})
