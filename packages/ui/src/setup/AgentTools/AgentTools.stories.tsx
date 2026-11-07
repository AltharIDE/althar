import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { AgentTools, type ToolRowModel, type ToolSyncModel } from './AgentTools'

/* The person's MCP servers and skills in Settings, with the switch that keeps their agents the same (ADR-097). */

const EVERY = ['lead', 'reviewer', 'coordinator'] as const

export const SERVERS: ReadonlyArray<ToolRowModel> = [
  {
    name: 'github',
    brand: Brand.GitHub,
    about: 'npx -y @github/github-mcp-server',
    sources: [
      { from: 'claude', where: '~/.claude.json' },
      { from: 'codex', where: '~/.codex/config.toml' },
    ],
    roles: EVERY,
    here: { claude: 'differs', codex: 'differs', opencode: 'missing' },
  },
  {
    name: 'linear',
    brand: Brand.Linear,
    about: 'https://mcp.linear.app/mcp',
    sources: [{ from: 'claude', where: '~/.claude.json' }],
    roles: EVERY,
    here: { claude: 'in', codex: 'missing', opencode: 'missing' },
  },
  {
    name: 'figma',
    about: 'http://127.0.0.1:3845/mcp',
    sources: [{ from: 'claude', where: '~/.claude.json' }],
    roles: ['lead'],
    here: { claude: 'in', codex: 'missing', opencode: 'missing' },
  },
  {
    name: 'context7',
    about: 'npx -y @upstash/context7-mcp',
    sources: [{ from: 'codex', where: '~/.codex/config.toml' }],
    roles: EVERY,
    here: { claude: 'missing', codex: 'in', opencode: 'missing' },
  },
  {
    name: 'playwright',
    about: 'npx @playwright/mcp@latest',
    sources: [{ from: 'opencode', where: '~/.config/opencode/opencode.json' }],
    roles: ['lead', 'reviewer'],
    here: { claude: 'missing', codex: 'missing', opencode: 'in' },
  },
]

const OFF: ToolSyncModel = {
  on: false,
  settle: [
    {
      kind: 'differs',
      name: 'github',
      ways: [
        { agent: 'claude', runs: 'npx -y @github/github-mcp-server' },
        { agent: 'codex', runs: 'docker run -i ghcr.io/github/github-mcp-server' },
      ],
    },
  ],
  since: [],
  targets: [
    { agent: 'claude', where: '~/.claude.json', adds: ['context7', 'playwright'], out: [] },
    { agent: 'codex', where: '~/.codex/config.toml', adds: ['figma', 'linear', 'playwright'], out: [] },
    { agent: 'opencode', where: '~/.config/opencode/opencode.json', adds: ['context7', 'figma', 'linear'], out: [] },
  ],
  errors: [],
}

const WEEK: ToolSyncModel = {
  on: true,
  settle: [
    { kind: 'unreadable', agent: 'opencode', file: '~/.config/opencode/opencode.json', problem: 'It isn’t JSON Althar can read.' },
    { kind: 'signIn', name: 'linear', agents: ['codex', 'opencode'] },
  ],
  since: [
    { id: 's1', at: '3 min ago', name: 'notion', kind: 'copied', from: 'claude', to: ['codex'], undone: false },
    { id: 's2', at: '2 Nov', name: 'context7', kind: 'tookOut', from: 'claude', to: [], undone: false },
  ],
  targets: [
    { agent: 'claude', where: '~/.claude.json', adds: ['playwright'], out: ['context7'] },
    { agent: 'codex', where: '~/.codex/config.toml', adds: ['figma', 'linear', 'notion', 'playwright'], out: [] },
    { agent: 'opencode', where: '~/.config/opencode/opencode.json', adds: ['context7', 'figma', 'linear'], out: [] },
  ],
  errors: [],
}

const meta = {
  title: 'Setup/AgentTools',
  component: AgentTools,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 760 }}>{Story()}</div>],
  args: {
    kind: 'server',
    rows: SERVERS,
    sync: OFF,
    scope: { projects: [{ id: 'p1', name: 'althar' }], value: null, onChange: fn() },
    onRoles: fn(),
    onSync: fn(),
    onKeep: fn(),
    onPick: fn(),
    onUndo: fn(),
    onSignIn: fn(),
    when: (at: string) => at,
  },
} satisfies Meta<typeof AgentTools>
export default meta
type Story = StoryObj<typeof meta>

/** Off: the switch and one line, over the role table. */
export const Servers: Story = {}

/** Turning it on says first what it writes into each agent's file, and what it leaves alone. */
export const TurningOn: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('switch', { name: 'Keep your agents’ servers the same' }))
    const dialog = within(document.body).getByRole('dialog')
    await expect(within(dialog).getByText('It leaves alone')).toBeVisible()
    await expect(within(dialog).getByText('~/.codex/config.toml')).toBeVisible()
  },
}

/** A week on: a file it can't read, a sign-in, what it did since, and what it added to each file. */
export const AWeekOn: Story = { args: { sync: WEEK } }

/** Turned off: Leave them in, or Take them out. */
export const TurningOff: Story = {
  args: { sync: WEEK },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('switch', { name: 'Keep your agents’ servers the same' }))
    await expect(within(document.body).getByRole('button', { name: 'Leave them in' })).toBeVisible()
  },
}

/** Skills: links only, said on the card, with no dialog; one name with two versions waits under To settle. */
export const Skills: Story = {
  args: {
    kind: 'skill',
    rows: [
      {
        name: 'design-review',
        about: 'Builds the app and Storybook, compares them, posts on the pull request',
        sources: [{ from: 'claude', where: '~/.claude/skills' }],
        roles: EVERY,
        here: { claude: 'in', codex: 'missing', opencode: 'in' },
      },
      {
        name: 'release-notes',
        about: 'Writes a release’s notes from its merged pull requests',
        sources: [
          { from: 'claude', where: '~/.claude/skills' },
          { from: 'codex', where: '~/.agents/skills' },
        ],
        roles: EVERY,
        here: { claude: 'differs', codex: 'differs', opencode: 'in' },
      },
      {
        name: 'improve',
        about: 'Surveys a codebase and writes plans for other agents',
        sources: [{ from: 'codex', where: '~/.agents/skills' }],
        roles: EVERY,
        here: { claude: 'missing', codex: 'in', opencode: 'in' },
      },
    ],
    sync: {
      on: false,
      settle: [
        {
          kind: 'differs',
          name: 'release-notes',
          ways: [
            { agent: 'claude', runs: '~/.claude/skills/release-notes' },
            { agent: 'codex', runs: '~/.agents/skills/release-notes' },
          ],
        },
      ],
      since: [],
      targets: [
        { agent: 'claude', where: '~/.claude/skills', adds: ['improve'], out: [] },
        { agent: 'codex', where: '~/.agents/skills', adds: ['design-review'], out: [] },
      ],
      errors: [],
    },
  },
}
