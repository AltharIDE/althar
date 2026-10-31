import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CONNECTED, SERVICES, WORKSPACE_TO_SIGN_IN, WORKSPACES } from '../../fixtures/setup'
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
 * another; Jira's sign-in stopped working and asks to be done again. Each
 * connection is a row of its own: where it reaches, over who it signs in
 * as, and its own Disconnect, named for it.
 */
export const Connected: Story = {
  args: { connections: CONNECTED },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Signed in as you')).toBeInTheDocument()
    await expect(c.getByText('git.meridian.dev')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Sign in again to meridian.atlassian.net' }))
    await expect(args.onSignInAgain).toHaveBeenCalledWith('conn_3')
    const [server] = c.getAllByRole('button', { name: 'Add a server' })
    if (!server) throw new Error('no Add a server')
    await userEvent.click(server)
    await expect(args.onAddServer).toHaveBeenCalledWith('github')
    await userEvent.click(c.getByRole('button', { name: 'Disconnect GitHub' }))
    await expect(args.onDisconnect).toHaveBeenCalledWith('conn_1')
    await userEvent.click(c.getByRole('button', { name: 'Disconnect git.meridian.dev' }))
    await expect(args.onDisconnect).toHaveBeenLastCalledWith('conn_2')
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
    const linear = within(c.getByRole('list', { name: 'Linear' }))
    await expect(linear.getAllByRole('listitem')).toHaveLength(2)
    await expect(linear.getByText('Meridian')).toBeInTheDocument()
    await expect(linear.getByText('Halyard')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Add a workspace' }))
    await expect(args.onAddWorkspace).toHaveBeenCalledWith('linear')
    await userEvent.click(linear.getByRole('button', { name: 'Disconnect Halyard' }))
    await expect(args.onDisconnect).toHaveBeenCalledWith('conn_5')
  },
}

/**
 * One of two workspaces to sign in again: its row shows who it signed in
 * as, like the other, and its Sign in again beside its Disconnect says the
 * rest.
 */
export const WorkspaceToSignIn: Story = {
  args: { connections: WORKSPACE_TO_SIGN_IN },
  play: async ({ args, canvasElement }) => {
    const linear = within(within(canvasElement).getByRole('list', { name: 'Linear' }))
    await expect(linear.getByText('dana')).toBeInTheDocument()
    await expect(linear.getAllByRole('button', { name: /^Sign in again/ })).toHaveLength(1)
    await userEvent.click(linear.getByRole('button', { name: 'Sign in again to Halyard' }))
    await expect(args.onSignInAgain).toHaveBeenCalledWith('conn_6')
    await userEvent.click(linear.getByRole('button', { name: 'Disconnect Meridian' }))
    await expect(args.onDisconnect).toHaveBeenCalledWith('conn_4')
  },
}

/** A workspace's name too long for its row ends in "…", and shows whole on hover. */
export const LongNames: Story = {
  args: {
    connections: [
      {
        id: 'conn_7',
        service: 'linear',
        account: 'someone.with.a.long.login@northwind-industries.io',
        workspace: 'Northwind Industries Platform Engineering',
      },
      { id: 'conn_8', service: 'linear', account: 'you', workspace: 'Halyard', needsSignIn: true },
    ],
  },
  decorators: [(Story) => <div style={{ width: 300 }}>{Story()}</div>],
  play: async ({ canvasElement }) => {
    const name = within(canvasElement).getByText('Northwind Industries Platform Engineering')
    await expect(name).toHaveAttribute('title', 'Northwind Industries Platform Engineering')
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
        { state: 'one of them to sign in again', node: <Connections {...args} connections={WORKSPACE_TO_SIGN_IN} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 300 }}>
              <Connections {...args} connections={CONNECTED} />
            </div>
          ),
        },
        {
          state: 'narrow, a workspace to sign in again',
          node: (
            <div style={{ width: 300 }}>
              <Connections {...args} connections={WORKSPACE_TO_SIGN_IN} />
            </div>
          ),
        },
      ]}
    />
  ),
}
