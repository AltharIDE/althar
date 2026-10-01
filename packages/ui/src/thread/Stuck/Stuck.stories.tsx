import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { STUCK } from '../../fixtures/stuck'
import { States, statesOn } from '../../storybook/States'
import { ThreadFrame } from '../../storybook/ThreadFrame'
import { Stuck } from './Stuck'

const meta = {
  title: 'Thread/Stuck',
  component: Stuck,
  args: { ...STUCK, onTell: fn(), onRetry: fn(), onAbandon: fn(), onUndo: fn() },
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <ThreadFrame>{Story()}</ThreadFrame>)],
} satisfies Meta<typeof Stuck>
export default meta
type Story = StoryObj<typeof meta>

/** What it tried, why it thinks it keeps failing, and the output; then what you can do. */
export const Default: Story = {}
/** Nothing else to hand the step to: only telling the lead, or abandoning. */
export const NoOtherAgent: Story = { args: { agents: [] } }
/** Without the lead's read or the output: what it tried is always there. */
export const Bare: Story = { args: { read: undefined, output: undefined } }
/** It came straight to you, as when the agent couldn't start: nothing was tried, so the step alone heads it. */
export const NothingTried: Story = {
  args: { tried: [], read: undefined, output: undefined, what: "Codex couldn't start. It isn't signed in." },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('What it tried')).toBeNull()
    await expect(c.queryByText(/after 0 tries/)).toBeNull()
  },
}

export const TellingTheLead: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Tell the lead' }))
    await userEvent.type(
      c.getByRole('textbox', { name: 'What should it do instead?' }),
      'Skip pre-1184 refunds in this test; MER-231 covers them.',
    )
    await userEvent.click(c.getByRole('button', { name: 'Send to the lead' }))
    await expect(args.onTell).toHaveBeenCalledWith('Skip pre-1184 refunds in this test; MER-231 covers them.')
    await expect(document.activeElement).toHaveTextContent('Told the lead')
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(c.getByRole('button', { name: 'Tell the lead' })).toBeInTheDocument()
  },
}

export const HandingToAnother: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Try another agent' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /Gemini 3 Pro/ }))
    await expect(args.onRetry).toHaveBeenCalledWith(STUCK.agents[0]!.model)
    await expect(document.activeElement).toHaveTextContent('Handed to')
  },
}

export const Abandoning: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Tell the lead' }))
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(c.getByRole('button', { name: 'Abandon' }))
    await expect(args.onAbandon).toHaveBeenCalledOnce()
    await expect(document.activeElement).toHaveTextContent('Abandoned')
  },
}

/** A step Charrette does itself, such as opening the pull request: tried again as it was, or gone on without. */
export const OneCharretteDoes: Story = {
  args: {
    step: 'Pull request',
    tried: [],
    read: undefined,
    output: undefined,
    agents: [],
    onTell: undefined,
    onRetry: undefined,
    onAgain: fn(),
    what: 'Charrette couldn’t push the branch: the host said the token can’t write to meridian/api.',
    text: { abandon: 'Go on without it' },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Try again' }))
    await expect(args.onAgain).toHaveBeenCalledOnce()
    await expect(document.activeElement).toHaveTextContent('Trying again')
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'waiting on you', node: <Stuck {...args} /> },
        { state: 'no other agent', node: <Stuck {...args} agents={[]} /> },
        { state: 'bare', node: <Stuck {...args} read={undefined} output={undefined} /> },
        { state: 'nothing tried', node: <Stuck {...args} tried={[]} read={undefined} output={undefined} /> },
        { state: 'tell, hover', force: 'hover', node: <Stuck {...args} read={undefined} output={undefined} /> },
        { state: 'tell, focus', force: 'focus', node: <Stuck {...args} read={undefined} output={undefined} /> },
      ]}
    />
  ),
}
