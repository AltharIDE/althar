import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { EVERY_STATE, FIRST_RUN } from '../../fixtures/setup'
import { RuntimeState } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { Runtimes, type RuntimesProps } from './Runtimes'

const meta = {
  title: 'Setup/Runtimes',
  component: Runtimes,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}>{Story()}</div>],
  args: {
    label: 'Agents on this Mac',
    runtimes: FIRST_RUN,
    onSignIn: fn(),
    onCancel: fn(),
    onCheck: fn(),
    onHelp: fn(),
    onAdd: fn(),
  },
} satisfies Meta<typeof Runtimes>
export default meta
type Story = StoryObj<typeof meta>

/** A first run: one signed in, one signed out, one not installed. Each says what it needs, and nothing more. */
export const FirstRun: Story = {}

/** Once work runs on them: out of usage with the work moved, signed out with tasks waiting (a call of yours), too old, being checked. */
export const EveryState: Story = { args: { runtimes: EVERY_STATE } }

/* Signing in, and changing your mind: the row follows. */
function Signing(args: RuntimesProps) {
  const [runtimes, setRuntimes] = useState(args.runtimes)
  const set = (id: string, state: RuntimeState) => setRuntimes((now) => now.map((r) => (r.id === id ? { ...r, state } : r)))
  return (
    <Runtimes
      {...args}
      runtimes={runtimes}
      onSignIn={(id) => {
        args.onSignIn?.(id)
        set(id, RuntimeState.SigningIn)
      }}
      onCancel={(id) => {
        args.onCancel?.(id)
        set(id, RuntimeState.SignedOut)
      }}
    />
  )
}

/** Sign in opens Codex's own sign-in and the row waits for it; Cancel stops waiting. */
export const SigningIn: Story = {
  render: (args) => <Signing {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Sign in' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('codex')
    await expect(c.getByText('Finish signing in to Codex in your browser')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalledWith('codex')
    await expect(c.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  },
}

/** Not installed: the runtime's own instructions, then a look again. */
export const Installing: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'How to install' }))
    await expect(args.onHelp).toHaveBeenCalledWith('gemini-cli')
    await userEvent.click(c.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheck).toHaveBeenCalledWith('gemini-cli')
  },
}

/** Without handlers, rows only say where each stands. */
export const ReadOnly: Story = {
  args: { runtimes: EVERY_STATE, onSignIn: undefined, onCancel: undefined, onCheck: undefined, onHelp: undefined, onAdd: undefined },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'first run', node: <Runtimes {...args} /> },
        { state: 'every state', node: <Runtimes {...args} runtimes={EVERY_STATE} /> },
        { state: 'hover', node: <Runtimes {...args} /> },
        { state: 'focus', node: <Runtimes {...args} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 340 }}>
              <Runtimes {...args} runtimes={EVERY_STATE} />
            </div>
          ),
        },
      ]}
    />
  ),
}
