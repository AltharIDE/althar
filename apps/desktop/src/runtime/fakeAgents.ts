import { agents, type AgentDefinition } from '@charrette/provider-adapters'
import { codexLikeMeanings, fakeAgent } from '@charrette/provider-adapters/testing'
import { Agents } from '@charrette/runtime'
import { Layer } from 'effect'

/*
 * The scripted fake agent under the registry's ids and names, in the
 * runtime's own process, for the end-to-end tests. What the person says
 * picks what it does: `hello`, `think`, `tool`, `updates`, and so on
 * (provider-adapters' FakeAgent). Loaded only when CHARRETTE_FAKE_AGENTS is
 * set.
 */

const definition = (real: AgentDefinition): AgentDefinition => ({
  ...real,
  modes: { ask: 'ask', readOnly: 'read-only' },
  options: { mode: 'mode', model: 'model' },
  signIn: { status: () => ({ command: 'true', args: [] }), read: () => true, login: real.signIn.login },
  permissions: codexLikeMeanings,
})

export const fakeAgents = Layer.succeed(
  Agents,
  Agents.from(
    [agents['claude-code'], agents.codex].map((real) => ({
      definition: definition(real),
      transport: () => ({ _tag: 'InProcess' as const, agent: fakeAgent() }),
    })),
  ),
)
