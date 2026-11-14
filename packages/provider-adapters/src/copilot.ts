import { join } from 'node:path'
import type { AgentDefinition } from './registry'

/** Althar owns the agent and account connection; no external engine or OAuth identity is substituted. */
export const copilotDefinition: AgentDefinition = {
  id: 'copilot-direct',
  native: 'copilot',
  name: 'GitHub Copilot',
  source: 'bundled',
  launch: () => {
    throw new Error('GitHub Copilot runs inside Althar; it has no external command.')
  },
  modes: { ask: 'ask', readOnly: 'read-only', reader: 'ask' },
  options: { mode: 'mode', model: 'model', effort: 'effort', ownEffort: '' },
  signIn: { read: () => undefined, paidBy: () => 'plan', login: '', inApp: { kind: 'copilot-device', ways: ['browser'] } },
  home: {
    managed: true,
    variable: 'ALTHAR_COPILOT_HOME',
    usual: (_env, home) => join(home, '.local', 'share', 'althar', 'copilot'),
    shared: () => [],
  },
  permissions: { rejectAndContinue: ['reject'], rejectAndStop: [], allowScopes: { allow: 'once' }, reasonInBand: true },
  service: { name: 'GitHub Copilot', url: 'https://api.githubcopilot.com' },
  ownHelpers: { off: true, how: 'Althar owns the agent loop.', kept: 'Helpers are started and supervised through Althar’s tools.' },
  skills: { layout: 'plain', capabilities: ['filesystem'], via: { kind: 'env', env: (folder) => ({ ALTHAR_NATIVE_SKILLS: folder }) } },
  knownGaps: [
    'GitHub must allow Althar’s OAuth application and Copilot model access for the account.',
    'Copilot’s inference endpoints are a compatibility integration and may change independently of Althar.',
    'Commands ask Althar’s permission; the native agent does not supply an OS sandbox.',
    'Copilot plan limits are recognized from request failures.',
  ],
}
