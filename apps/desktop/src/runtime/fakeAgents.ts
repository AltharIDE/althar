import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { agents, type AgentDefinition } from '@charrette/provider-adapters'
import { codexLikeMeanings, fakeAgent } from '@charrette/provider-adapters/testing'
import { Agents } from '@charrette/runtime'
import { Layer } from 'effect'

/*
 * The scripted fake agent under the registry's ids and names, in the
 * runtime's own process, for the end-to-end tests. What the person says
 * picks what it does: `hello`, `think`, `tool`, `updates`, and so on
 * (provider-adapters' FakeAgent). Loaded only when CHARRETTE_FAKE_AGENTS is
 * set, in a build with the test hooks.
 */

const definition = (real: AgentDefinition): AgentDefinition => ({
  ...real,
  modes: { ask: 'ask', readOnly: 'read-only', reader: 'read-only' },
  options: { mode: 'mode', model: 'model', effort: 'effort' },
  signIn: { status: () => ({ command: 'true', args: [] }), read: () => true, paidBy: () => 'plan', login: real.signIn.login },
  // Its usual folder is the test's, so nothing of the person's is read or linked.
  home: {
    variable: 'CHARRETTE_FAKE_HOME',
    usual: () => join(process.env.CHARRETTE_PROFILE ?? tmpdir(), 'fake-homes', real.id),
    shared: [],
  },
  permissions: codexLikeMeanings,
})

/**
 * Agents out of usage: CHARRETTE_FAKE_OUT lists them, each with the seconds
 * from launch until it is back (`claude-code:3600`), or without, out for good
 * and saying no reset time. One account alone is named by its folder's name,
 * or `usual` for the agent's usual folder: `codex@usual:3600`.
 */
const out = new Map(
  (process.env.CHARRETTE_FAKE_OUT ?? '')
    .split(',')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [agentId = '', seconds] = entry.split(':')
      return [agentId, seconds === undefined ? {} : { until: Date.now() + Number(seconds) * 1000 }] as const
    }),
)

export const fakeAgents = Layer.succeed(
  Agents,
  Agents.from(
    [agents['claude-code'], agents.codex].map((real) => {
      const limited = out.get(real.id)
      return {
        definition: definition(real),
        transport: (_cwd: string, env: Readonly<Record<string, string>> = {}) => {
          const home = env.CHARRETTE_FAKE_HOME
          const own = out.get(`${real.id}@${home === undefined ? 'usual' : basename(home)}`) ?? limited
          return { _tag: 'InProcess' as const, agent: fakeAgent(own === undefined ? {} : { outOfUsage: own }) }
        },
      }
    }),
  ),
)
