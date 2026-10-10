import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CONNECT, FIRST_RUN } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { Runtimes } from '../Runtimes/Runtimes'
import { ConnectAgent } from './ConnectAgent'

const meta = {
  title: 'Setup/ConnectAgent',
  component: ConnectAgent,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
  args: { options: CONNECT, onHelp: fn(), onKey: fn(), onConnect: fn(), onCommand: fn() },
} satisfies Meta<typeof ConnectAgent>
export default meta
type Story = StoryObj<typeof meta>

/** Every other way in: apps it didn't find, APIs that take a key, model servers here, any ACP command. */
export const Default: Story = {}

/** A key is typed once, hidden, and goes to the Keychain. */
export const AddingAKey: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getAllByRole('button', { name: 'Add a key' })[0]!)
    const field = c.getByLabelText('Anthropic API API key')
    await expect(field).toHaveFocus()
    await expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'sk-test-0000')
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(args.onKey).toHaveBeenCalledWith('anthropic', 'sk-test-0000')
    await expect(c.queryByLabelText('Anthropic API API key')).not.toBeInTheDocument()
  },
}

/** Cancelling a key puts the field away without saving. */
export const CancellingAKey: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const [, second] = c.getAllByRole('button', { name: 'Add a key' })
    if (!second) throw new Error('no second key row')
    await userEvent.click(second)
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(args.onKey).not.toHaveBeenCalled()
  },
}

/** A local server that is running connects in one press; install instructions open for an app. */
export const ConnectingLocally: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Connect' }))
    await expect(args.onConnect).toHaveBeenCalledWith('ollama')
    const [install] = c.getAllByRole('button', { name: 'How to install' })
    if (!install) throw new Error('no install row')
    await userEvent.click(install)
    await expect(args.onHelp).toHaveBeenCalledWith('cursor')
  },
}

/** Any agent that speaks ACP, by the command that starts it. */
export const AddingACommand: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add' }))
    await expect(args.onCommand).not.toHaveBeenCalled()
    await expect(c.getByRole('textbox', { name: 'Command' })).toHaveAccessibleDescription('Type the command that starts it')
    await userEvent.type(c.getByRole('textbox', { name: 'Command' }), 'goose acp')
    await userEvent.click(c.getByRole('button', { name: 'Add' }))
    await expect(args.onCommand).toHaveBeenCalledWith('goose acp')
  },
}

/** A key the provider refused: the form stays open and says why. */
export const KeyRefused: Story = {
  args: { savingKey: null, keyError: { id: 'anthropic', message: 'Anthropic didn’t accept that key.' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const [first] = c.getAllByRole('button', { name: 'Add a key' })
    if (first) await userEvent.click(first)
    await expect(c.getByLabelText('Anthropic API API key')).toHaveAccessibleDescription('Anthropic didn’t accept that key.')
  },
}

/** Without a way to add a command, that section isn't there. */
export const WithoutCommands: Story = { args: { onCommand: undefined } }

/** Where it opens: from "Connect another" under the agents. */
export const FromTheAgents: Story = {
  decorators: [(Story) => <div style={{ width: 560, minHeight: 620 }}>{Story()}</div>],
  render: (args) => <Runtimes label="Agents on this Mac" runtimes={FIRST_RUN} connect={<ConnectAgent {...args} />} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Connect another' }))
    await waitFor(() => expect(within(document.body).getByRole('dialog', { name: 'Connect another' })).toBeInTheDocument())
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      cells={[
        { state: 'default', node: <ConnectAgent {...args} /> },
        { state: 'no commands', node: <ConnectAgent {...args} onCommand={undefined} /> },
      ]}
    />
  ),
}
