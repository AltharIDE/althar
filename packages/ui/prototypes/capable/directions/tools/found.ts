// Scrappy, surface 4: the MCP servers and skills Althar found on this computer and in althar, and which roles get them.
import { Brand } from '../../../../src/foundations/brands/brands'

export type Role = 'lead' | 'reviewer' | 'coordinator'
export const ROLES: ReadonlyArray<{ id: Role; name: string; plural: string }> = [
  { id: 'lead', name: 'Lead', plural: 'Leads' },
  { id: 'reviewer', name: 'Reviewer', plural: 'Reviewers' },
  { id: 'coordinator', name: 'Coordinator', plural: 'Coordinator' },
]

export const PROJECTS = ['althar', 'site', 'meridian'] as const

export type SourceId = 'claude' | 'codex' | 'opencode' | 'project' | 'plugin' | 'althar'

export const SOURCES: Readonly<Record<SourceId, { name: string; path: string; brand?: Brand }>> = {
  claude: { name: 'Claude Code', path: '~/.claude.json', brand: Brand.ClaudeCode },
  codex: { name: 'Codex', path: '~/.codex/config.toml', brand: Brand.Codex },
  opencode: { name: 'OpenCode', path: '~/.config/opencode/opencode.json', brand: Brand.OpenCode },
  project: { name: 'althar', path: '.mcp.json' },
  plugin: { name: 'superpowers', path: 'a Claude Code plugin', brand: Brand.ClaudeCode },
  althar: { name: 'Althar’s catalog', path: 'kept by Althar' },
}

export interface Found {
  readonly id: string
  readonly name: string
  readonly brand?: Brand
  /** Where it was found: the first is where its settings are read from. */
  readonly sources: ReadonlyArray<SourceId>
  /** What it runs or reaches, as its config says. */
  readonly runs: string
  /** It can change things outside: post, merge, move issues. */
  readonly acts?: boolean
  readonly roles: ReadonlyArray<Role>
  /** Only in these projects; absent for every project. */
  readonly projects?: ReadonlyArray<string>
}

const EVERY: ReadonlyArray<Role> = ['lead', 'reviewer', 'coordinator']

export const SERVERS: ReadonlyArray<Found> = [
  {
    id: 'github',
    name: 'github',
    brand: Brand.GitHub,
    sources: ['claude', 'codex'],
    runs: 'npx -y @github/github-mcp-server',
    acts: true,
    roles: EVERY,
  },
  { id: 'linear', name: 'linear', brand: Brand.Linear, sources: ['claude'], runs: 'https://mcp.linear.app/mcp', acts: true, roles: EVERY },
  { id: 'figma', name: 'figma', sources: ['claude'], runs: 'http://127.0.0.1:3845/mcp', roles: ['lead'] },
  { id: 'sentry', name: 'sentry', sources: ['claude'], runs: 'https://mcp.sentry.dev/mcp', roles: EVERY },
  { id: 'context7', name: 'context7', sources: ['codex'], runs: 'npx -y @upstash/context7-mcp', roles: EVERY },
  { id: 'playwright', name: 'playwright', sources: ['opencode'], runs: 'npx @playwright/mcp@latest', roles: ['lead', 'reviewer'] },
  {
    id: 'storybook',
    name: 'storybook',
    sources: ['project'],
    runs: 'http://localhost:6006/mcp',
    roles: ['lead', 'reviewer'],
    projects: ['althar'],
  },
]

export const SKILLS: ReadonlyArray<Found> = [
  {
    id: 'design-review',
    name: 'design-review',
    sources: ['claude'],
    runs: 'Builds the app and Storybook, compares them, posts on the pull request',
    acts: true,
    roles: ['lead', 'reviewer'],
  },
  {
    id: 'release-notes',
    name: 'release-notes',
    sources: ['claude'],
    runs: 'Writes a release’s notes from its merged pull requests',
    roles: EVERY,
  },
  {
    id: 'brainstorming',
    name: 'brainstorming',
    sources: ['plugin'],
    runs: 'Before building something whose design isn’t settled',
    roles: ['lead', 'coordinator'],
  },
  {
    id: 'systematic-debugging',
    name: 'systematic-debugging',
    sources: ['plugin'],
    runs: 'When a bug’s cause isn’t known yet',
    roles: ['lead', 'reviewer'],
  },
  {
    id: 'althar-prototype',
    name: 'althar-prototype',
    sources: ['project'],
    runs: 'Prototypes on the real kit, one live page, A/B/C',
    roles: ['lead'],
    projects: ['althar'],
  },
  { id: 'frontend-design', name: 'frontend-design', sources: ['althar'], runs: 'When building or restyling an interface', roles: EVERY },
]

/** Which roles and projects get it, as the person set them on the page. */
export interface Reach {
  readonly roles: ReadonlyArray<Role>
  readonly projects: ReadonlyArray<string>
}

export const reachOf = (found: Found): Reach => ({ roles: found.roles, projects: found.projects ?? [...PROJECTS] })

/** Who gets it, in a few words: Every role, Leads and reviewers, Leads · althar only. */
export const reachWords = (reach: Reach): string => {
  const roles =
    reach.roles.length === ROLES.length
      ? 'Every role'
      : reach.roles.length === 0
        ? 'No role'
        : ROLES.filter((one) => reach.roles.includes(one.id))
            .map((one, index) => (index === 0 ? one.plural : one.plural.toLowerCase()))
            .join(' and ')
  const projects =
    reach.projects.length === PROJECTS.length
      ? ''
      : reach.projects.length === 1
        ? ` · ${reach.projects[0]} only`
        : ` · ${reach.projects.length} projects`
  return `${roles}${projects}`
}
