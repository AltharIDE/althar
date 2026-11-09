import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TOOL_AGENTS } from '../../fixtures/tools'
import { AddServerDialog } from './AddServerDialog'
import { SERVER_STARTERS } from './starters'

const meta = {
  title: 'Setup/ToolTiles/AddServerDialog',
  component: AddServerDialog,
  args: { sync: true, agents: TOOL_AGENTS, taken: ['github', 'linear'], onAdd: fn(), onClose: fn() },
} satisfies Meta<typeof AddServerDialog>
export default meta
type Story = StoryObj<typeof meta>

const dialog = () => within(document.body)

/** With Same servers everywhere on, every agent gets it. Each problem is said at its field, and focus goes to the first. */
export const Blank: Story = {
  play: async ({ args }) => {
    const body = dialog()
    await expect(body.getByText('Every agent gets it: Claude Code, Codex and OpenCode.')).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await expect(body.getByText('Give it a name.')).toBeVisible()
    await expect(body.getByText('Give the address it is reached at.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await userEvent.type(body.getByRole('textbox', { name: 'Name' }), 'linear')
    await expect(body.getByText('There is a server named linear already.')).toBeVisible()
    await userEvent.clear(body.getByRole('textbox', { name: 'Name' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Name' }), 'sentry')
    await userEvent.type(body.getByRole('textbox', { name: 'Address' }), 'mcp.sentry.dev')
    await expect(body.getByText('An address starts with https:// or http://.')).toBeVisible()
    await userEvent.clear(body.getByRole('textbox', { name: 'Address' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Address' }), 'https://mcp.sentry.dev/mcp')
    await userEvent.click(body.getByRole('button', { name: 'Add a header' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Name 1' }), 'Authorization')
    await userEvent.type(body.getByRole('textbox', { name: 'Value 1' }), 'Bearer ${{SENTRY_TOKEN}')
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith(
      { name: 'sentry', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: 'Bearer ${SENTRY_TOKEN}' } },
      ['claude', 'codex', 'opencode'],
    )
  },
}

/** A command, its words split as a shell would, and the variables it runs with. */
export const Command: Story = {
  play: async ({ args }) => {
    const body = dialog()
    await userEvent.type(body.getByRole('textbox', { name: 'Name' }), 'postgres')
    await userEvent.click(body.getByRole('radio', { name: 'A command' }))
    await userEvent.type(
      body.getByRole('textbox', { name: 'Command' }),
      'npx -y @modelcontextprotocol/server-postgres "postgresql://localhost/my db"',
    )
    await userEvent.click(body.getByRole('button', { name: 'Add a variable' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Name 1' }), '1PASSWORD')
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await expect(body.getByText('Use letters, numbers and _, not starting with a number.')).toBeVisible()
    await expect(body.getByRole('textbox', { name: 'Name 1' })).toHaveFocus()
    await userEvent.clear(body.getByRole('textbox', { name: 'Name 1' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Name 1' }), 'PGPASSWORD')
    await userEvent.type(body.getByRole('textbox', { name: 'Value 1' }), '${{PGPASSWORD}')
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith(
      {
        name: 'postgres',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/my db'],
        env: { PGPASSWORD: '${PGPASSWORD}' },
      },
      ['claude', 'codex', 'opencode'],
    )
  },
}

/** Opened from one often added: filled in. */
export const FilledIn: Story = {
  args: { start: SERVER_STARTERS.find((one) => one.name === 'playwright') ?? null, taken: [] },
  play: async ({ args }) => {
    const body = dialog()
    await expect(body.getByRole('textbox', { name: 'Command' })).toHaveValue('npx @playwright/mcp@latest')
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith({ name: 'playwright', command: 'npx', args: ['@playwright/mcp@latest'] }, [
      'claude',
      'codex',
      'opencode',
    ])
  },
}

/** With sync off, the person's agents by their marks: the signed-in ones pressed, and at least one must be. */
export const PickAgents: Story = {
  args: { sync: false, start: SERVER_STARTERS[3] ?? null, taken: [] },
  play: async ({ args }) => {
    const body = dialog()
    await expect(body.getByRole('button', { name: 'Claude Code' })).toHaveAttribute('aria-pressed', 'true')
    await expect(body.getByRole('button', { name: 'OpenCode' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(body.getByRole('button', { name: 'Claude Code' }))
    await userEvent.click(body.getByRole('button', { name: 'Codex' }))
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await expect(body.getByText('Press at least one agent.')).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'OpenCode' }))
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith({ name: 'notion', url: 'https://mcp.notion.com/mcp' }, ['opencode'])
  },
}

/** While it is added, and when it couldn't be, in part: the words under the form. */
export const Busy: Story = { args: { busy: true, start: SERVER_STARTERS[1] ?? null, taken: [] } }

export const FailedInPart: Story = {
  args: {
    start: SERVER_STARTERS[2] ?? null,
    taken: [],
    error: 'figma went into Claude Code and Codex. OpenCode’s settings couldn’t be written: ~/.config/opencode/opencode.json is read-only.',
  },
  play: async () => {
    await expect(dialog().getByRole('alert')).toHaveTextContent('read-only')
  },
}

export const Dark: Story = { args: { sync: false }, globals: { theme: 'dark' } }
