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

/**
 * Its agent's service kept failing, though Althar waited longer between each
 * try: nothing was wrong with the work, so Try again is the way on, first.
 */
export const ServiceKeptFailing: Story = {
  args: {
    step: 'Implement',
    what: "Anthropic's service kept failing: API Error: 500 Internal server error. This is a server-side issue, usually temporary — try again in a moment. Try again, or hand the step to another agent.",
    tried: [{ id: 'waited', what: 'Tried again 3 times, waiting longer each time', result: 'it failed each time' }],
    tries: 3,
    read: undefined,
    output: undefined,
    onAgain: fn(),
    againFirst: true,
  },
  play: async ({ canvasElement }) => {
    const [first] = within(canvasElement).getAllByRole('button')
    await expect(first).toHaveAccessibleName('Try again')
    // One line for all its tries, and the corner counts them all.
    await expect(within(canvasElement).getByText('Implement, after 3 tries')).toBeInTheDocument()
  },
}

/**
 * Its agent is signed out: signing in again, in Settings, puts it right, so
 * it is the card's own button, first. It doesn't answer the card; Try again
 * does, once the agent is signed in.
 */
export const SignedOut: Story = {
  args: {
    step: 'Implement',
    what: 'Claude Code is signed out. Sign in again, then try again, or hand the step to another agent.',
    tried: [],
    read: undefined,
    output: undefined,
    onAgain: fn(),
    fix: { label: 'Sign in again', onFix: fn() },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const [first] = c.getAllByRole('button')
    await expect(first).toHaveAccessibleName('Sign in again')
    await userEvent.click(c.getByRole('button', { name: 'Sign in again' }))
    await expect(args.fix?.onFix).toHaveBeenCalled()
    // Still waiting on the person: signing in elsewhere answers nothing, and Try again stays.
    await expect(c.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  },
}

export const TryingAgain: Story = {
  args: ServiceKeptFailing.args,
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }))
    await expect(args.onAgain).toHaveBeenCalled()
    await expect(document.activeElement).toHaveTextContent('Trying again')
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
    await userEvent.click(c.getByRole('button', { name: 'Hand to another agent' }))
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
    await userEvent.click(c.getByRole('button', { name: 'Abandon this step' }))
    await expect(args.onAbandon).toHaveBeenCalledOnce()
    await expect(document.activeElement).toHaveTextContent('Abandoned')
  },
}

/** A step Althar does itself, such as opening the pull request: tried again as it was, or gone on without. */
export const OneAltharDoes: Story = {
  args: {
    step: 'Pull request',
    tried: [],
    read: undefined,
    output: undefined,
    agents: [],
    onTell: undefined,
    onRetry: undefined,
    onAgain: fn(),
    what: 'Althar couldn’t push the branch: the host said the token can’t write to meridian/api.',
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

/**
 * An agent out of usage, which said no reset: telling it anything would hit
 * the same limit, so handing the step on comes first, then trying it again
 * once it is back.
 */
export const OutOfUsage: Story = {
  args: {
    tried: [],
    read: undefined,
    output: undefined,
    onTell: undefined,
    onAgain: fn(),
    what: 'Codex reached its usage limit and didn’t say when it resets.',
    text: { again: 'Try Codex again' },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Try Codex again' }))
    await expect(args.onAgain).toHaveBeenCalledOnce()
  },
}

/** Report this, quiet at the end of its answers: it opens Report a problem with this task. */
export const Reporting: Story = {
  args: { onReport: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Report this' }))
    await expect(args.onReport).toHaveBeenCalledOnce()
    // It answers nothing: the step still waits.
    await expect(c.getByRole('button', { name: 'Tell the lead' })).toBeInTheDocument()
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
        { state: 'with report this', node: <Stuck {...args} read={undefined} output={undefined} onReport={() => {}} /> },
        { state: 'tell, hover', force: 'hover', node: <Stuck {...args} read={undefined} output={undefined} /> },
        { state: 'tell, focus', force: 'focus', node: <Stuck {...args} read={undefined} output={undefined} /> },
      ]}
    />
  ),
}
