import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CONNECTED, SERVICES, WORKSPACES } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { Connections } from './Connections'

const meta = {
  title: 'Setup/Connections',
  component: Connections,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 520 }}>{Story()}</div>],
  args: {
    label: 'Code hosts and trackers',
    services: SERVICES,
    connections: [],
    onConnect: fn(),
    onSignInAgain: fn(),
    onAddServer: fn(),
    onAddWorkspace: fn(),
    onDisconnect: fn(),
  },
} satisfies Meta<typeof Connections>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing connected: each service says where the projects' code on it is, and has one Connect, which opens its walk in. */
export const NothingConnected: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Not connected · Meridian’s code is here')).toBeInTheDocument()
    const [github] = c.getAllByRole('button', { name: 'Connect' })
    if (!github) throw new Error('no Connect')
    await userEvent.click(github)
    await expect(args.onConnect).toHaveBeenCalledWith('github')
  },
}

/**
 * Signed in on github.com and a company's own server, which can take
 * another; Jira's sign-in stopped working and asks to be done again.
 */
export const Connected: Story = {
  args: { connections: CONNECTED },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('git.meridian.dev', { exact: false })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Sign in again' }))
    await expect(args.onSignInAgain).toHaveBeenCalledWith('conn_3')
    const [server] = c.getAllByRole('button', { name: 'Add a server' })
    if (!server) throw new Error('no Add a server')
    await userEvent.click(server)
    await expect(args.onAddServer).toHaveBeenCalledWith('github')
    const [first] = c.getAllByRole('button', { name: 'Disconnect' })
    if (!first) throw new Error('no Disconnect')
    await userEvent.click(first)
    await expect(args.onDisconnect).toHaveBeenCalledWith('conn_1')
  },
}

/**
 * Two of Linear's workspaces side by side, each saying which it reaches and
 * disconnecting on its own; Linear offers another workspace, not a server.
 */
export const Workspaces: Story = {
  args: { connections: WORKSPACES },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Meridian')).toBeInTheDocument()
    await expect(c.getByText('Halyard')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Add a workspace' }))
    await expect(args.onAddWorkspace).toHaveBeenCalledWith('linear')
    const disconnects = c.getAllByRole('button', { name: 'Disconnect' })
    await expect(disconnects).toHaveLength(3)
    const halyard = disconnects[2]
    if (!halyard) throw new Error('no Disconnect')
    await userEvent.click(halyard)
    await expect(args.onDisconnect).toHaveBeenCalledWith('conn_5')
  },
}

/** Without a way to add a server, a connected service offers none. */
export const NoServers: Story = {
  args: { connections: CONNECTED, onAddServer: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Add a server' })).toBeNull()
  },
}

/** Narrow, as a column of Settings has it: how each stands runs under its name. */
export const Narrow: Story = {
  args: { connections: CONNECTED },
  decorators: [(Story) => <div style={{ width: 300 }}>{Story()}</div>],
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'not connected', node: <Connections {...args} /> },
        { state: 'connected, and one to sign in again', node: <Connections {...args} connections={CONNECTED} /> },
        { state: 'two of Linear’s workspaces', node: <Connections {...args} connections={WORKSPACES} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 300 }}>
              <Connections {...args} connections={CONNECTED} />
            </div>
          ),
        },
      ]}
    />
  ),
}
