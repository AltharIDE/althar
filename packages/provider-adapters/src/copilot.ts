import { join } from 'node:path'
import type { AgentDefinition, LaunchSpec } from './registry'
import { openCodeCredentials } from './usageSources'

/** A first-class Copilot connection. OpenCode owns OAuth and the agent loop; no Copilot CLI is involved. */
export const copilotDefinition = (engine: AgentDefinition): AgentDefinition => {
  const { usageLimits: _openCodeGoLimits, ...runtime } = engine
  const onlyCopilot = (spec: LaunchSpec): LaunchSpec => ({
    ...spec,
    env: {
      ...spec.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        ...JSON.parse(spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}'),
        enabled_providers: ['github-copilot'],
      }),
    },
  })
  return {
    ...runtime,
    id: 'copilot-direct',
    name: 'GitHub Copilot',
    service: { name: 'GitHub Copilot', url: 'https://api.githubcopilot.com' },
    ...(engine.cli === undefined
      ? {}
      : {
          cli: {
            ...engine.cli,
            managed: true,
            ...(engine.cli.download === undefined ? {} : { download: { ...engine.cli.download, size: '115 MB' } }),
          },
        }),
    launch: (node) => {
      const spec = engine.launch(node)
      return onlyCopilot({ ...spec, args: [...spec.args, '--standalone'] })
    },
    home: { ...engine.home, managed: true, usual: (_env, home) => join(home, '.local', 'share', 'althar', 'copilot'), shared: () => [] },
    signIn: {
      status: () => ({ command: 'opencode', args: ['auth', 'list', '--standalone', '--format', 'json'] }),
      read: (output) => {
        const first = output.indexOf('[')
        const last = output.lastIndexOf(']')
        const credentials = openCodeCredentials(first < 0 ? output.trim() : output.slice(first, last + 1))
        return credentials === null ? undefined : credentials.some((entry) => entry.provider === 'github-copilot')
      },
      paidBy: () => 'plan',
      login: '',
      inApp: {
        kind: 'opencode-copilot',
        ways: ['browser'],
        run: (_node, host) =>
          onlyCopilot({
            command: 'opencode',
            args: [
              'auth',
              'login',
              'github-copilot',
              '--standalone',
              '--method',
              'device',
              '--answer',
              `deploymentType=${host === undefined ? 'github.com' : 'enterprise'}`,
              ...(host === undefined ? [] : ['--answer', `enterpriseUrl=${host}`]),
            ],
          }),
      },
    },
    // Keep the same provider restriction when a session adds skills, web permissions or review settings.
    sessionEnv: (own, options) => {
      const env = { ...own, ...engine.sessionEnv?.(own, options) }
      return onlyCopilot({ command: 'opencode', args: [], env }).env ?? {}
    },
    knownGaps: [
      'OpenCode supplies the agent behavior; GitHub supplies the models and applies account and enterprise access controls.',
      'An organization may require approval for OpenCode’s GitHub OAuth application.',
      'Copilot plan limits are recognized from request failures.',
    ],
  }
}
