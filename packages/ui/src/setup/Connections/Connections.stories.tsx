import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CONNECTED, SERVICES } from '../../fixtures/setup'
import { Connections, type ServiceSignIn } from './Connections'

const meta = {
  title: 'Setup/Connections',
  component: Connections,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 520 }}>{Story()}</div>],
  args: {
    label: 'Code hosts and trackers',
    services: SERVICES,
    connections: [],
    onSignIn: fn(),
    onCancelSignIn: fn(),
    onToken: fn(),
    onDisconnect: fn(),
  },
} satisfies Meta<typeof Connections>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing connected: each service says what it is for, and offers its way in. */
export const NothingConnected: Story = {}

/** Signed in on github.com and a company's own server; Linear's sign-in stopped working and asks to be done again. */
export const Connected: Story = { args: { connections: CONNECTED } }

/** GitHub's own sign-in: a code to type on its page, while Charrette waits. */
export const TypingACode: Story = {
  args: { signingIn: { service: 'github', kind: 'device', code: 'ABCD-1234', url: 'https://github.com/login/device' } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('ABCD-1234')).toBeInTheDocument()
    await expect(c.getByRole('link', { name: /Open github.com/ })).toHaveAttribute('href', 'https://github.com/login/device')
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancelSignIn).toHaveBeenCalled()
  },
}

/** A sign-in approved in the browser, which comes back to Charrette. */
export const ApprovingInTheBrowser: Story = {
  args: { signingIn: { service: 'github', kind: 'browser', url: 'https://github.com/login/oauth/authorize?client_id=x' } },
}

/** A sign-in that ended without a token: said, with a way to try again. */
export const SignInEnded: Story = {
  args: { signingIn: { service: 'github', kind: 'ended', message: 'The code expired.' } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Try again' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('github')
  },
}

/** A token is pasted once, hidden, and kept encrypted; Jira's goes with the account's email. */
export const PastingAToken: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const [linear, jira] = c.getAllByRole('button', { name: 'Add a token' })
    if (!linear || !jira) throw new Error('no token rows')
    await userEvent.click(linear)
    const field = c.getByLabelText('Linear token')
    await expect(field).toHaveFocus()
    await expect(field).toHaveAttribute('type', 'password')
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(c.getByText('Paste the token first')).toBeInTheDocument()
    await userEvent.type(field, 'lin_api_0000')
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(args.onToken).toHaveBeenCalledWith('linear', { token: 'lin_api_0000' })
    await expect(c.queryByLabelText('Linear token')).not.toBeInTheDocument()
  },
}

/** Jira, which has no one address, asks for its site's, and the email the token belongs to. */
export const ATokenWithItsEmail: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const jira = c.getAllByRole('button', { name: 'Add a token' }).at(-1)
    if (!jira) throw new Error('no Jira row')
    await userEvent.click(jira)
    await expect(c.getByLabelText('Server address')).toHaveAttribute('placeholder', 'https://your-site.atlassian.net')
    await userEvent.type(c.getByLabelText('Server address'), 'https://meridian.atlassian.net')
    await userEvent.type(c.getByLabelText('Jira token'), 'atl_0000{Enter}')
    await expect(c.getByText('Type the email the token belongs to')).toBeInTheDocument()
    await userEvent.type(c.getByLabelText('Email'), 'you@meridian.dev')
    await userEvent.type(c.getByLabelText('Jira token'), '{Enter}')
    await expect(args.onToken).toHaveBeenCalledWith('jira_cloud', {
      instance: 'https://meridian.atlassian.net',
      user: 'you@meridian.dev',
      token: 'atl_0000',
    })
  },
}

/** A company's own server, by its address, with a token for it. */
export const AddingAServer: Story = {
  args: { connections: [CONNECTED[0]!] },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add a server' }))
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(c.getByText('Type the server’s address')).toBeInTheDocument()
    await userEvent.type(c.getByLabelText('Server address'), 'https://git.meridian.dev')
    await userEvent.type(c.getByLabelText('GitHub token'), 'ghp_0000')
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(args.onToken).toHaveBeenCalledWith('github', { instance: 'https://git.meridian.dev', token: 'ghp_0000' })
  },
}

/** A token the service refused: said under the field, which stays open. */
function Refused(props: Parameters<typeof Connections>[0]) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<{ service: string; message: string } | null>(null)
  return (
    <Connections
      {...props}
      saving={saving}
      tokenError={error}
      onToken={(service) => {
        setSaving(service)
        window.setTimeout(() => {
          setError({ service, message: 'Linear says that key isn’t valid.' })
          setSaving(null)
        }, 50)
      }}
    />
  )
}
export const ATokenRefused: Story = {
  render: (args) => <Refused {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const [linear] = c.getAllByRole('button', { name: 'Add a token' })
    if (!linear) throw new Error('no Linear row')
    await userEvent.click(linear)
    await userEvent.type(c.getByLabelText('Linear token'), 'wrong{Enter}')
    await expect(await c.findByText('Linear says that key isn’t valid.')).toBeInTheDocument()
    await expect(c.getByLabelText('Linear token')).toBeInTheDocument()
  },
}

/** Signing in again, for a connection whose token stopped working; disconnecting one. */
export const SigningInAgain: Story = {
  args: { connections: CONNECTED },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Sign in again' }))
    await expect(c.getByLabelText('Linear token')).toBeInTheDocument()
    await userEvent.click(c.getAllByRole('button', { name: 'Disconnect' })[0]!)
    await expect(args.onDisconnect).toHaveBeenCalledWith('conn_1')
  },
}

/** Signing in on GitHub starts its own sign-in; a token is the other way in. */
export const SigningIn: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Sign in' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('github')
    await userEvent.click(c.getByRole('button', { name: 'Use a token' }))
    await expect(c.getByLabelText('GitHub token')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByLabelText('GitHub token')).not.toBeInTheDocument()
  },
}

const signing: ServiceSignIn = { service: 'github', kind: 'device', code: 'WDJB-MJHT', url: 'https://github.com/login/device' }
/** In a narrow column, as the side panel is: a service’s name and what connects it share a line, and how it stands runs under both. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 340 }}>{Story()}</div>],
  args: { connections: CONNECTED, signingIn: signing },
}

/** Connected, in the side panel’s width. */
export const InThePanel: Story = {
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
  args: { connections: CONNECTED },
}
