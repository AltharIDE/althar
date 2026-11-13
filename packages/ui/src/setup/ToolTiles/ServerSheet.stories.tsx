import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CROWDED_PROJECTS, filesOf, SERVERS, TOOL_AGENTS, TOOL_COUNTS, TOOL_PROJECTS } from '../../fixtures/tools'
import { ServerSheet } from './ServerSheet'
import type { ServerTileModel } from './tools'

const of = (id: string): ServerTileModel => SERVERS.find((one) => one.id === id) ?? SERVERS[0]!
const width = (px: number) => (Story: () => ReactNode) => <div style={{ maxWidth: px }}>{Story()}</div>

const linear = of('linear')
// Notion's last start failed because Claude Code's sign-in to it ran out: its file says so, with its Sign in.
const notion: ServerTileModel = { ...of('notion'), signIn: { ...of('notion').signIn, claude: 'no' } }

const meta = {
  title: 'Setup/ToolTiles/ServerSheet',
  component: ServerSheet,
  parameters: { layout: 'padded' },
  decorators: [width(880)],
  args: {
    server: linear,
    agents: TOOL_AGENTS,
    projects: TOOL_PROJECTS,
    sync: true,
    files: filesOf(linear),
    tools: TOOL_COUNTS.linear,
    onBack: fn(),
    onRoles: fn(),
    onProject: fn(),
    onKeepOut: fn(),
    onUseWay: fn(),
    onSignIn: fn(),
    onRemove: fn(),
  },
} satisfies Meta<typeof ServerSheet>
export default meta
type Story = StoryObj<typeof meta>

/** What it runs, who gets it, its projects, and each agent's file: copied lines in green, with a Take it out and a Sign in each. */
export const Usual: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('switch', { name: 'Reviewers get linear' }))
    await expect(args.onRoles).toHaveBeenCalledWith(['lead', 'coordinator'])
    await userEvent.click(canvas.getByRole('button', { name: 'fnt' }))
    await expect(args.onProject).toHaveBeenCalledWith('p2', false)
    await userEvent.click(canvas.getByRole('button', { name: 'Take linear out of Codex' }))
    await expect(args.onKeepOut).toHaveBeenCalledWith('codex', true)
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in to linear in OpenCode' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('opencode')
    await expect(canvas.getAllByText('Lines Althar copied:')).toHaveLength(2)
    await userEvent.keyboard('{Escape}')
    await expect(args.onBack).toHaveBeenCalled()
  },
}

/** Run two ways: npx in Claude Code, docker in Codex, side by side, each offering its way everywhere. */
export const TwoWays: Story = {
  args: { server: of('github'), files: filesOf(of('github')), tools: 41 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/^Its own way/)).toBeVisible()
    await expect(canvas.getByText('Not in its settings')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Use Codex’s way everywhere' }))
    await expect(args.onUseWay).toHaveBeenCalledWith('codex')
  },
}

/** Kept out of one agent: its lines struck through, said in words too, with Put it back. */
export const KeptOut: Story = {
  args: { server: of('context7'), files: filesOf(of('context7')), tools: 2 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Lines kept out, as they would be:')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Put context7 back in Claude Code' }))
    await expect(args.onKeepOut).toHaveBeenCalledWith('claude', false)
  },
}

/** One an agent can't take: why, in its card. */
export const CantGoThere: Story = {
  args: { server: of('sentry'), files: filesOf(of('sentry')), tools: 14 },
}

/** Its last start failed: why, and where; no tool count, since none could be read. */
export const Failed: Story = {
  args: { server: notion, files: filesOf(notion), tools: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/^Claude Code: Notion refused/)).toBeVisible()
    await expect(canvas.queryByText(/tools$/)).toBeNull()
  },
}

/** A repository's own: its .mcp.json, no projects and no Remove…. */
export const Repository: Story = {
  args: { server: of('p1:site-browser'), files: filesOf(of('p1:site-browser')), tools: 22 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('.mcp.json')).toBeVisible()
    await expect(canvas.queryByRole('group', { name: /^Projects/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Remove…' })).toBeNull()
  },
}

/** With one project, there is no Projects row. */
export const OneProject: Story = {
  args: { projects: TOOL_PROJECTS.slice(0, 1) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('Projects')).toBeNull()
  },
}

/** Eight projects' marks, a long name among them, wrap in their row. */
export const ManyProjects: Story = { args: { projects: CROWDED_PROJECTS } }

/** With sync off, each file is the agent's own: nothing to take out or put back here. */
export const SyncOff: Story = {
  args: { sync: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /^Take linear out/ })).toBeNull()
  },
}

/** The files while they are read, in their places. */
export const ReadingFiles: Story = { args: { files: null, tools: null } }

/** The files couldn't be read: why, with Try again. */
export const FilesFailed: Story = {
  args: { files: null, filesError: 'Codex didn’t answer `codex mcp list` in time.', onRetryFiles: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }))
    await expect(args.onRetryFiles).toHaveBeenCalled()
  },
}

/** Remove… asks first, saying which agents it comes out of; the call failing in part shows its words. */
export const RemoveFailed: Story = {
  args: { removeError: 'It came out of Claude Code and Codex, but OpenCode’s settings couldn’t be written: permission denied.' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Remove…' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Remove linear?' }))
    await expect(dialog.getByRole('alert')).toHaveTextContent('permission denied')
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }))
    await expect(args.onRemove).toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  },
}

/** A long path ends in … in its card's head. */
export const LongPath: Story = {
  args: {
    files: filesOf(linear).map((file) =>
      file.agent === 'opencode' ? { ...file, where: '~/Library/Application Support/opencode/profiles/work/opencode.json' } : file,
    ),
  },
}

export const Narrow: Story = { decorators: [width(500)] }

export const Dark: Story = { globals: { theme: 'dark' } }

export const DarkTwoWays: Story = { args: { server: of('github'), files: filesOf(of('github')), tools: 41 }, globals: { theme: 'dark' } }
