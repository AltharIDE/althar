import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { z } from 'zod'

import type { AgentDefinition } from './registry'

/** A connection chosen by the person. Commands are executable/argv pairs, never shell text. */
export interface AcpConnection {
  readonly id: `acp-${string}`
  readonly name: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly mode: string | null
  readonly readerMode: string | null
  readonly modeOption: string
  readonly modelOption: string
  readonly effortOption: string | null
  readonly held: Readonly<Record<string, string>>
  readonly registryId: string | null
  readonly registryVersion: string | null
}

const distribution = z
  .object({
    package: z.string().min(1).max(300),
    args: z.array(z.string().max(4096)).max(100).optional(),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096)).optional(),
  })
  .passthrough()

const binary = z
  .object({
    cmd: z.string().min(1).max(500),
    args: z.array(z.string().max(4096)).max(100).optional(),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096)).optional(),
  })
  .passthrough()

const manifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  name: z.string().min(1).max(160),
  version: z.string().min(1).max(100),
  description: z.string().max(5000).optional(),
  repository: z.url({ protocol: /^https$/ }).optional(),
  website: z.url({ protocol: /^https$/ }).optional(),
  distribution: z.object({
    npx: distribution.optional(),
    uvx: distribution.optional(),
    binary: z.record(z.string(), binary).optional(),
  }),
})

export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

/** Only metadata is read here. Looking through the registry never installs or starts an agent. */
export const registryIn = (input: unknown) => {
  const parsed = z.union([z.array(manifest).max(1000), z.object({ agents: z.array(manifest).max(1000) })]).parse(input)
  const all = Array.isArray(parsed) ? parsed : parsed.agents
  if (new Set(all.map((agent) => agent.id)).size !== all.length) throw new Error('The agent registry contains duplicate identifiers.')
  return all
}

export type RegistryManifest = ReturnType<typeof registryIn>[number]

/** A registry launch for this device; binary entries refer to an existing installation. */
export const registryCommand = (agent: RegistryManifest, platform = process.platform, arch = process.arch) => {
  if (agent.distribution.npx !== undefined) {
    const entry = agent.distribution.npx
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+@[0-9][a-zA-Z0-9.+_-]*$/.test(entry.package) || !entry.package.endsWith(`@${agent.version}`))
      throw new Error('The registry package must name its exact version.')
    return { command: 'npx', args: ['--yes', entry.package, ...(entry.args ?? [])], env: entry.env ?? {} }
  }
  if (agent.distribution.uvx !== undefined) {
    const entry = agent.distribution.uvx
    if (
      !/^[a-zA-Z0-9._-]+(?:==|@)[0-9][a-zA-Z0-9.+_-]*$/.test(entry.package) ||
      (!entry.package.endsWith(`==${agent.version}`) && !entry.package.endsWith(`@${agent.version}`))
    )
      throw new Error('The registry package must name its exact version.')
    return { command: 'uvx', args: [entry.package, ...(entry.args ?? [])], env: entry.env ?? {} }
  }
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch
  const os = platform === 'win32' ? 'windows' : platform
  const entry = agent.distribution.binary?.[`${os}-${cpu}`]
  if (entry === undefined) return null
  const command = basename(entry.cmd.replaceAll('\\', '/'))
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(command)) throw new Error('The registry executable is invalid.')
  return { command, args: [...(entry.args ?? [])], env: entry.env ?? {} }
}

/** Profiles seed configuration; a profile is not a claim that its installed version passed the contract. */
export const ACP_PROFILES = [
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor-agent',
    args: ['acp'],
    mode: 'default',
    readerMode: 'plan',
    guide: 'https://cursor.com/docs/cli/acp',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp', '--approval-mode', 'default'],
    mode: 'default',
    readerMode: 'default',
    guide: 'https://geminicli.com/docs/ide-integration/',
  },
  {
    id: 'goose',
    name: 'Goose',
    command: 'goose',
    args: ['acp'],
    mode: 'approve',
    readerMode: 'approve',
    guide: 'https://block.github.io/goose/docs/guides/acp/',
  },
  { id: 'pi-acp', name: 'Pi', command: 'pi-acp', args: [], mode: null, readerMode: null, guide: 'https://github.com/svkozak/pi-acp' },
  {
    id: 'omp',
    name: 'Oh My Pi',
    command: 'omp',
    args: ['acp'],
    env: { PI_NO_PTY: '1' },
    mode: 'default',
    readerMode: 'default',
    guide: 'https://omp.sh',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    command: 'kiro-cli',
    args: ['acp', '--agent-engine=v3'],
    mode: 'default',
    readerMode: 'default',
    guide: 'https://kiro.dev/docs/cli/acp/',
  },
  {
    id: 'muse-code',
    name: 'Muse Code',
    command: 'muse',
    args: ['acp'],
    env: { MUSE_EXPERIMENTAL_ACP: 'on' },
    mode: 'default',
    readerMode: 'default',
    guide: 'https://dev.meta.ai/docs/muse-code',
  },
  {
    id: 'cline',
    name: 'Cline',
    command: 'cline',
    args: ['--acp'],
    mode: 'act',
    readerMode: 'act',
    guide: 'https://docs.cline.bot/cline-cli/overview',
  },
  { id: 'kilo', name: 'Kilo', command: 'kilo', args: ['acp'], mode: 'build', readerMode: 'build', guide: 'https://kilo.ai/docs' },
  {
    id: 'mastracode',
    name: 'Mastra Code',
    command: 'mastracode',
    args: ['--acp'],
    mode: 'build',
    readerMode: 'build',
    guide: 'https://mastra.ai/reference/code-sdk/acp-server',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    command: 'hermes',
    args: ['acp'],
    mode: null,
    readerMode: null,
    guide: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp',
  },
  {
    id: 'letta',
    name: 'Letta',
    command: 'npx',
    args: ['--yes', '@letta-ai/letta-acp'],
    mode: 'standard',
    readerMode: 'standard',
    modeOption: 'permissions',
    guide: 'https://github.com/letta-ai/letta-acp',
  },
] as const

/** External agents get no implicit permission grants, extra accounts, or permission-judge role. */
export const externalDefinition = (connection: AcpConnection): AgentDefinition => {
  const profile = ACP_PROFILES.find((one) => one.id === connection.registryId)
  return {
    id: connection.id,
    name: connection.name,
    source: 'user_installed',
    untrustedRepositories: false,
    launch: () => ({
      command: connection.command,
      args: connection.args,
      ...(connection.env === undefined ? {} : { env: connection.env }),
    }),
    modes: { ask: connection.mode, readOnly: connection.readerMode, reader: connection.readerMode },
    options: {
      mode: connection.modeOption,
      model: connection.modelOption,
      ...(connection.effortOption === null ? {} : { effort: connection.effortOption }),
      held: connection.held,
    },
    signIn: { read: () => undefined, login: '' },
    // A generic command's credential location is unknown. Never pretend changing an
    // invented environment variable isolates its credentials or creates an account.
    home: { variable: 'ALTHAR_ACP_HOME', usual: () => join(homedir(), '.althar-acp'), shared: () => [], accounts: 'one' },
    permissions: { rejectAndContinue: [], rejectAndStop: [], allowScopes: {} },
    cli: { name: connection.command, node: true, ...(profile === undefined ? {} : { guide: profile.guide }) },
    ownHelpers: { off: false, how: 'Controlled by this agent’s own configuration', kept: 'Reported over ACP where available' },
    skills: null,
    commands: 'althar',
    knownGaps: [
      'One existing sign-in; sign in with the agent’s own tools.',
      'Althar-selected skills and permission judging are unavailable.',
    ],
  }
}
