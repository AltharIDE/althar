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
    onTell: undefined,
    onAgain: fn(),
    primary: 'again',
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
    what: 'Claude Code is signed out.',
    tried: [],
    read: undefined,
    output: undefined,
    onTell: undefined,
    onAgain: fn(),
    primary: 'again',
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

/**
 * One provider within its agent refused its sign-in, not the agent: the card names the provider and the model, and the agent's
 * own words stay under it. Signing in to that provider is the card's own button.
 */
export const ProviderRefused: Story = {
  args: {
    step: 'Review',
    what: 'OpenCode Go refused the sign-in for DeepSeek V4.1 Flash.',
    said: 'Authentication required: provider authentication required',
    tried: [],
    read: undefined,
    output: undefined,
    // A review: it can't be told anything, and goes on with another agent, again, or without.
    onTell: undefined,
    onAgain: fn(),
    onReport: fn(),
    fix: { label: 'Sign in to OpenCode Go', onFix: fn() },
    text: {
      again: 'Review again',
      retry: 'Review with another agent',
      retryLabel: 'Review with',
      abandon: 'Skip the review',
    },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Authentication required: provider authentication required')).toBeInTheDocument()
    const [first] = c.getAllByRole('button')
    await expect(first).toHaveAccessibleName('Sign in to OpenCode Go')
    await userEvent.click(first!)
    await expect(args.fix?.onFix).toHaveBeenCalled()
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
    primary: 'retry',
    what: 'Codex is out of usage.',
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

/*
 * Each reason a step stops, as the app asks about it: only the ways on that
 * fit what went wrong, the way to take first. The lead is told what to do
 * only where its own work went wrong; where Althar, the service or the
 * session failed, the step starts again on its agent.
 */

/** A card as the app shows one: nothing of the lead's read or the output, Report this at its end. */
const asked = { tried: [], read: undefined, output: undefined, onTell: undefined, onAgain: undefined, onReport: fn() }

/** The card offers these buttons, in this order, the first the way to take. */
const offers =
  (...names: string[]) =>
  async ({ canvasElement }: { canvasElement: HTMLElement }) =>
    expect(
      within(canvasElement)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([...names, 'Report this'])

/** Althar crashed on the step twice in a row: nothing to tell the lead, which was cut off, so its agent starts again, first. */
export const Restarted: Story = {
  args: {
    ...asked,
    step: 'Implement',
    what: 'Althar stopped unexpectedly twice while this step ran.',
    onAgain: fn(),
    primary: 'again',
    text: { again: 'Start Claude Code again', tryingAgain: 'Starting Claude Code again' },
  },
  play: offers('Start Claude Code again', 'Hand to another agent', 'Abandon this step'),
}

/** Its agent's session closed under it: started again, first. */
export const SessionEnded: Story = {
  args: { ...Restarted.args, what: 'Claude Code closed before finishing the step.' },
  play: offers('Start Claude Code again', 'Hand to another agent', 'Abandon this step'),
}

/** Its agent couldn't start: tried again, first, or handed on. */
export const FailedToStart: Story = {
  args: { ...asked, step: 'Implement', what: "Codex couldn't start. It exited with code 1.", onAgain: fn(), primary: 'again' },
  play: offers('Try again', 'Hand to another agent', 'Abandon this step'),
}

/** It stopped without reporting, after a reminder: the lead is told what to do, first; reminding it again would do the same. */
export const NoReport: Story = {
  args: {
    ...asked,
    step: 'Implement',
    what: 'Codex stopped without saying whether the step is done.',
    tried: [{ id: 'reminded', what: 'Reminded it to report', result: 'it stopped again' }],
    onTell: fn(),
  },
  play: offers('Tell the lead', 'Hand to another agent', 'Abandon this step'),
}

/** Gone quiet after Althar told it to carry on and started it again: told what to do, first. */
export const Stalled: Story = {
  args: {
    ...NoReport.args,
    what: 'Codex has gone quiet.',
    tried: [
      { id: 'carried_on', what: 'Told it to carry on', result: 'it stopped again' },
      { id: 'restarted', what: 'Started Codex again from the start', result: 'it stopped again' },
    ],
  },
  play: offers('Tell the lead', 'Hand to another agent', 'Abandon this step'),
}

/** The same result again and again, after Althar told it to try another way: told what to do, first. */
export const Looping: Story = {
  args: {
    ...NoReport.args,
    what: 'Codex keeps getting the same result.',
    tried: [{ id: 'redirected', what: 'Told it to try another way', result: 'it did the same again' }],
  },
  play: offers('Tell the lead', 'Hand to another agent', 'Abandon this step'),
}

/** It refused to go on: told what to do, first, or handed on. */
export const Refused: Story = {
  args: { ...NoReport.args, what: 'Codex refused to go on.', tried: [] },
  play: offers('Tell the lead', 'Hand to another agent', 'Abandon this step'),
}

/** Long at it: let carry on, first, or told what to do instead, handed on, or stopped. */
export const OverBudget: Story = {
  args: {
    ...asked,
    step: 'Implement',
    what: 'Codex has worked on this step for 3 hours.',
    onTell: fn(),
    onAgain: fn(),
    primary: 'again',
    text: { again: 'Let Codex carry on', tryingAgain: 'Codex carries on' },
  },
  play: offers('Let Codex carry on', 'Tell the lead', 'Hand to another agent', 'Abandon this step'),
}

const reviewText = {
  again: 'Review again',
  tryingAgain: 'Reviewing again',
  retry: 'Review with another agent',
  retryLabel: 'Review with',
  abandon: 'Skip the review',
  abandoned: 'Skipped the review',
}

/** A reviewer that went quiet: another reviewer, first; a review is never told what to do. */
export const ReviewStalled: Story = {
  args: { ...asked, step: 'Review', what: 'Codex has gone quiet.', onAgain: fn(), primary: 'retry', text: reviewText },
  play: offers('Review with another agent', 'Review again', 'Skip the review'),
}

/** Out of rounds, with changes no review has seen: reviewed again, first, or accepted as it is. */
export const RoundLimit: Story = {
  args: {
    ...ReviewStalled.args,
    what: 'Reviewed three times. 2 findings open.',
    primary: 'again',
    text: { ...reviewText, abandon: 'Accept it as it is', abandoned: 'Accepted as it is' },
  },
  play: offers('Review again', 'Review with another agent', 'Accept it as it is'),
}

/** The pull request, where Althar isn't connected to the host: connected first, then tried again. */
export const NotConnected: Story = {
  args: {
    ...OneAltharDoes.args,
    ...asked,
    agents: [],
    onAgain: fn(),
    what: "Althar isn't connected to this repository's host.",
    fix: { label: 'Connect', onFix: fn() },
  },
  play: offers('Connect', 'Try again', 'Go on without it'),
}

/** Every reason side by side, as the app asks about each. */
export const EveryReason: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'restarted', node: <Stuck {...args} {...Restarted.args} /> },
        { state: 'session ended', node: <Stuck {...args} {...SessionEnded.args} /> },
        { state: 'failed to start', node: <Stuck {...args} {...FailedToStart.args} /> },
        { state: 'service kept failing', node: <Stuck {...args} {...ServiceKeptFailing.args} onReport={fn()} /> },
        { state: 'signed out', node: <Stuck {...args} {...SignedOut.args} onReport={fn()} /> },
        { state: 'out of usage', node: <Stuck {...args} {...OutOfUsage.args} onReport={fn()} /> },
        { state: 'no report', node: <Stuck {...args} {...NoReport.args} /> },
        { state: 'stalled', node: <Stuck {...args} {...Stalled.args} /> },
        { state: 'looping', node: <Stuck {...args} {...Looping.args} /> },
        { state: 'refused', node: <Stuck {...args} {...Refused.args} /> },
        { state: 'over budget', node: <Stuck {...args} {...OverBudget.args} /> },
        { state: 'review stalled', node: <Stuck {...args} {...ReviewStalled.args} /> },
        { state: 'round limit', node: <Stuck {...args} {...RoundLimit.args} /> },
        { state: 'pull request, not connected', node: <Stuck {...args} {...NotConnected.args} /> },
        { state: 'pull request', node: <Stuck {...args} {...OneAltharDoes.args} onReport={fn()} /> },
      ]}
    />
  ),
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
