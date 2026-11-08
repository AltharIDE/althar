import { Brand } from '../foundations/brands/brands'
import { ProjectInk } from '../foundations/ProjectMark/drawing'
import type {
  ServerTileModel,
  SkillTileModel,
  ToolAgentView,
  ToolFileView,
  ToolHereState,
  ToolProjectView,
  ToolSignInState,
  ToolSyncModel,
} from '../setup/ToolTiles/tools'

/*
 * The person's MCP servers and skills, as althar's had them on 8 November:
 * three agents signed in; eight servers of theirs (one failing, two waiting
 * on a sign-in, one set up two ways); six skills (one added from GitHub,
 * with an update); a repository's own server and skill; and two projects.
 * Crowded adds fourteen servers and six projects.
 */

export const TOOL_AGENTS: readonly ToolAgentView[] = [
  { id: 'claude', name: 'Claude Code', brand: Brand.ClaudeCode, file: '~/.claude.json', folder: '~/.claude/skills', signedIn: true },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, file: '~/.codex/config.toml', folder: '~/.codex/skills', signedIn: true },
  {
    id: 'opencode',
    name: 'OpenCode',
    brand: Brand.OpenCode,
    file: '~/.config/opencode/opencode.json',
    folder: '~/.config/opencode/skills',
    signedIn: false,
  },
]

export const TOOL_PROJECTS: readonly ToolProjectView[] = [
  { id: 'p1', name: 'althar', ink: ProjectInk.Clay },
  { id: 'p2', name: 'fnt', ink: ProjectInk.Moss },
]

export const CROWDED_PROJECTS: readonly ToolProjectView[] = [
  ...TOOL_PROJECTS,
  { id: 'p3', name: 'charrette-site', ink: ProjectInk.Indigo },
  { id: 'p4', name: 'brand', ink: ProjectInk.Ochre },
  { id: 'p5', name: 'meridian', ink: ProjectInk.Teal },
  { id: 'p6', name: 'ledger', ink: ProjectInk.Plum },
  { id: 'p7', name: 'infrastructure-and-deployment-tooling', ink: ProjectInk.Slate },
  { id: 'p8', name: 'mobile', ink: ProjectInk.Rose },
]

const EVERY = ['lead', 'reviewer', 'coordinator'] as const
type Here = Readonly<Record<string, ToolHereState>>
type SignIn = Readonly<Record<string, ToolSignInState>>
const ALL_IN: Here = { claude: 'in', codex: 'added', opencode: 'added' }
const NONE: SignIn = { claude: 'none', codex: 'none', opencode: 'none' }
const SIGNED: SignIn = { claude: 'yes', codex: 'yes', opencode: 'yes' }

const server = (name: string, runs: string, over: Partial<ServerTileModel> = {}): ServerTileModel => ({
  id: name,
  name,
  runs,
  roles: EVERY,
  offIn: [],
  repository: null,
  here: ALL_IN,
  signIn: NONE,
  failed: null,
  ...over,
})

export const SERVERS: readonly ServerTileModel[] = [
  server('github', 'npx -y @modelcontextprotocol/server-github', {
    brand: Brand.GitHub,
    here: { claude: 'in', codex: 'differs', opencode: 'missing' },
  }),
  server('linear', 'https://mcp.linear.app/mcp', { brand: Brand.Linear, signIn: { claude: 'yes', codex: 'no', opencode: 'no' } }),
  server('figma', 'https://mcp.figma.com/mcp', { roles: ['lead'], offIn: ['p2'], signIn: SIGNED }),
  server('sentry', 'https://mcp.sentry.dev/sse', {
    roles: ['lead', 'reviewer'],
    here: { claude: 'in', codex: 'cant', opencode: 'added' },
    signIn: { claude: 'yes', codex: 'none', opencode: 'yes' },
  }),
  server('notion', 'https://mcp.notion.com/mcp', {
    signIn: SIGNED,
    failed: { agent: 'claude', why: 'Notion refused its sign-in (401): it was signed out on notion.so.' },
  }),
  server('context7', 'npx -y @upstash/context7-mcp', { here: { claude: 'out', codex: 'in', opencode: 'added' } }),
  server('playwright', 'npx @playwright/mcp@latest', { here: { claude: 'added', codex: 'added', opencode: 'in' } }),
  server('akiflow', 'https://mcp.akiflow.com/mcp', {
    roles: ['coordinator'],
    offIn: ['p2'],
    signIn: { claude: 'no', codex: 'no', opencode: 'no' },
  }),
  server('site-browser', 'npx @playwright/mcp@latest --isolated --port 5320', {
    id: 'p1:site-browser',
    roles: ['lead', 'reviewer'],
    repository: 'p1',
    here: { claude: 'in', codex: 'missing', opencode: 'missing' },
  }),
]

export const CROWD: readonly ServerTileModel[] = [
  server('gitlab', 'https://gitlab.com/api/v4/mcp', { brand: Brand.GitLab, offIn: ['p1', 'p2', 'p3'], signIn: SIGNED }),
  server('jira', 'https://mcp.atlassian.com/v1/mcp', {
    brand: Brand.Jira,
    roles: ['coordinator'],
    offIn: ['p1', 'p2'],
    signIn: { claude: 'yes', codex: 'no', opencode: 'yes' },
  }),
  server('confluence', 'https://mcp.atlassian.com/v1/mcp?product=confluence', {
    brand: Brand.Confluence,
    roles: ['coordinator'],
    signIn: SIGNED,
  }),
  server('stripe', 'https://mcp.stripe.com', { roles: ['lead'], offIn: ['p1', 'p3', 'p4', 'p7'], signIn: SIGNED }),
  server('vercel', 'https://mcp.vercel.com', { offIn: ['p5', 'p6'] }),
  server('cloudflare-bindings-and-workers-observability', 'https://bindings.mcp.cloudflare.com/mcp', { signIn: SIGNED }),
  server('postgres', 'npx -y @modelcontextprotocol/server-postgres postgresql://localhost/ledger', {
    roles: ['lead'],
    offIn: ['p1', 'p2', 'p3', 'p4', 'p7', 'p8'],
  }),
  server('supabase', 'npx -y @supabase/mcp-server-supabase --read-only', { roles: ['lead', 'reviewer'] }),
  server('slack', 'https://mcp.slack.com/mcp', {
    roles: ['coordinator'],
    failed: { agent: null, why: 'Slack refused its token: the app was removed from the workspace.' },
  }),
  server('google-drive', 'npx -y @modelcontextprotocol/server-gdrive', { roles: [] }),
  server('datadog', 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp', { roles: ['lead', 'reviewer'], signIn: SIGNED }),
  server('kubernetes', 'npx -y mcp-server-kubernetes', { roles: ['lead'], offIn: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p8'] }),
  server('docker', 'docker mcp gateway run', { here: { claude: 'in', codex: 'added', opencode: 'cant' } }),
  server('aws-docs', 'uvx awslabs.aws-documentation-mcp-server@latest', { roles: ['lead', 'reviewer'] }),
]

export const SERVER_SYNC: ToolSyncModel = {
  on: true,
  targets: [
    { agent: 'claude', where: '~/.claude.json', adds: ['playwright'] },
    { agent: 'codex', where: '~/.codex/config.toml', adds: ['linear', 'figma', 'notion', 'playwright', 'akiflow'] },
    { agent: 'opencode', where: '~/.config/opencode/opencode.json', adds: ['linear', 'figma', 'sentry', 'notion', 'context7', 'akiflow'] },
  ],
  changes: [
    { id: 's1', at: '6 Nov', name: 'notion', kind: 'copied', from: 'claude', to: ['codex', 'opencode'], undone: false },
    { id: 's2', at: '4 Nov', name: 'context7', kind: 'tookOut', from: 'claude', to: [], undone: false },
    { id: 's3', at: '2 Nov', name: 'playwright', kind: 'copied', from: 'opencode', to: ['claude', 'codex'], undone: false },
  ],
  errors: [],
}

/** Sync off: what turning it on would add to each agent. */
export const SERVER_SYNC_OFF: ToolSyncModel = {
  on: false,
  targets: [
    { agent: 'claude', where: '~/.claude.json', adds: ['playwright'] },
    { agent: 'codex', where: '~/.codex/config.toml', adds: ['linear', 'figma', 'notion', 'playwright', 'akiflow'] },
    { agent: 'opencode', where: '~/.config/opencode/opencode.json', adds: [] },
  ],
  changes: [],
  errors: [],
}

const quoted = (words: readonly string[]) => words.map((one) => `"${one}"`)

/** The lines a server takes in an agent's own file, as that agent writes them. */
export const linesFor = (agent: string, name: string, runs: string): readonly string[] => {
  const address = runs.startsWith('http')
  const [command = '', ...args] = runs.split(' ')
  if (agent === 'codex')
    return address
      ? [`[mcp_servers.${name}]`, `url = "${runs}"`]
      : [`[mcp_servers.${name}]`, `command = "${command}"`, `args = [${quoted(args).join(', ')}]`]
  if (agent === 'opencode')
    return address
      ? [`"${name}": {`, '  "type": "remote",', `  "url": "${runs}"`, '}']
      : [`"${name}": {`, '  "type": "local",', `  "command": [${quoted([command, ...args]).join(', ')}]`, '}']
  return address
    ? [`"${name}": {`, '  "type": "http",', `  "url": "${runs}"`, '}']
    : [`"${name}": {`, `  "command": "${command}",`, `  "args": [${quoted(args).join(', ')}]`, '}']
}

const STATE: Record<ToolHereState, ToolFileView['state']> = {
  in: 'yours',
  added: 'copied',
  differs: 'differs',
  out: 'out',
  missing: 'missing',
  cant: 'cant',
}
const OTHER_WAY: Readonly<Record<string, string>> = { github: 'docker run -i --rm ghcr.io/github/github-mcp-server' }
const CANT: Readonly<Record<string, string>> = {
  sentry: 'Codex doesn’t run servers over SSE.',
  docker: 'OpenCode can’t run the Docker gateway.',
}

/** Each agent's file as it keeps a server, from where it stands in each. */
export const filesOf = (one: ServerTileModel, agents: readonly ToolAgentView[] = TOOL_AGENTS): readonly ToolFileView[] => {
  if (one.repository !== null)
    return [
      { agent: 'repository', where: '.mcp.json', state: 'yours', lines: linesFor('claude', one.name, one.runs), why: null, signIn: 'none' },
    ]
  return agents.map((agent) => {
    const state = STATE[one.here[agent.id] ?? 'missing']
    const runs = state === 'differs' ? (OTHER_WAY[one.name] ?? one.runs) : one.runs
    return {
      agent: agent.id,
      where: agent.file,
      state,
      lines: state === 'missing' || state === 'cant' ? [] : linesFor(agent.id, one.name, runs),
      why: state === 'cant' ? (CANT[one.name] ?? null) : null,
      signIn: one.signIn[agent.id] ?? 'unknown',
    }
  })
}

/** How many tools each offers, where Althar's own check could count them. */
export const TOOL_COUNTS: Readonly<Record<string, number>> = {
  github: 41,
  linear: 23,
  figma: 9,
  sentry: 14,
  context7: 2,
  playwright: 22,
  'p1:site-browser': 22,
}

const skill = (name: string, about: string, over: Partial<SkillTileModel> = {}): SkillTileModel => ({
  id: name,
  name,
  about,
  roles: EVERY,
  offIn: [],
  repository: null,
  here: { claude: 'in', codex: 'missing', opencode: 'in' },
  home: `~/.claude/skills/${name}`,
  from: null,
  update: false,
  ...over,
})

export const SKILLS: readonly SkillTileModel[] = [
  skill('impeccable', 'Design that holds up: a direction, a comp, then the build, reviewed against both.'),
  skill('improve', 'Survey a codebase as a senior advisor and write prioritised plans for other agents to carry out.'),
  skill('dataviz', 'Charts, dashboards and stat tiles that read as one system, light and dark.', {
    roles: ['lead', 'reviewer'],
    offIn: ['p2'],
  }),
  skill('release-notes', 'Write the notes for a release from the pull requests merged since the last tag.', {
    here: { claude: 'missing', codex: 'in', opencode: 'in' },
    home: '~/.codex/skills/release-notes',
  }),
  skill('cloudflare', 'Choose and build on Cloudflare: Workers, Durable Objects, Wrangler.', {
    here: { claude: 'in', codex: 'cant', opencode: 'cant' },
    home: '~/.claude/plugins/cloudflare/skills/cloudflare',
  }),
  skill('release-checklist', 'Before cutting a release: the checks, the notes, the tag.', {
    here: { claude: 'added', codex: 'added', opencode: 'added' },
    home: '~/.agents/skills/release-checklist',
    from: 'charrette/agent-skills',
    update: true,
  }),
  skill('run', 'Launch and drive althar’s app to see a change working.', {
    id: 'p1:run',
    roles: ['lead', 'reviewer'],
    repository: 'p1',
    home: '.claude/skills/run',
  }),
]

export const SKILL_SYNC: ToolSyncModel = {
  on: false,
  targets: [
    { agent: 'claude', where: '~/.claude/skills', adds: ['release-notes'] },
    { agent: 'codex', where: '~/.codex/skills', adds: ['impeccable', 'improve', 'dataviz'] },
  ],
}
