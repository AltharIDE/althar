import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CSSProperties } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CODEX, OPUS } from '../../fixtures/models'
import { GraphNodeState } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { StepGraph, type StepGraphLane, type StepGraphRound, type StepGraphStep } from './StepGraph'

const LANES: StepGraphLane[] = [
  { id: 'lead', who: { kind: 'model', model: OPUS }, lead: true },
  { id: 'reviewer', who: { kind: 'model', model: CODEX } },
  { id: 'althar', who: { kind: 'althar', name: 'Althar' } },
]

const ASKED: StepGraphRound = { id: 'r1', by: 'You asked', said: 'Retry the checkout call when the payment provider times out.' }
const FOLLOWED: StepGraphRound = {
  id: 'r2',
  by: 'You followed up',
  after: '17h later',
  said: 'The retry should back off, and give up after three tries with a message the shopper can act on.',
}

type Step = Omit<StepGraphStep, 'round'> & { round?: string }
const step = (id: string, lane: string, label: string, state: GraphNodeState, extra: Partial<Step> = {}): StepGraphStep => ({
  id,
  lane,
  round: 'r1',
  label,
  state,
  ...extra,
})

const SIMPLE: StepGraphStep[] = [
  step('implement', 'lead', 'Implement', GraphNodeState.Done, { corner: '24m' }),
  step('review-1', 'reviewer', 'Review 1', GraphNodeState.Done, { corner: '2m', outcome: '2 findings', warn: true }),
  step('settle-1', 'lead', 'Settle', GraphNodeState.Done, { corner: '6m', outcome: '2 settled' }),
  step('review-2', 'reviewer', 'Review 2', GraphNodeState.Done, { corner: '1m', outcome: 'Passed' }),
  step('publish', 'althar', 'Pull request', GraphNodeState.Done, { corner: '9s', outcome: 'Draft #229' }),
]

const LOOP: StepGraphStep[] = [
  step('implement', 'lead', 'Implement', GraphNodeState.Done, { corner: '55m' }),
  step('review-1', 'reviewer', 'Review 1', GraphNodeState.Done, { corner: '2m', outcome: '3 findings', warn: true }),
  step('settle-1', 'lead', 'Settle', GraphNodeState.Done, { corner: '37m', outcome: '3 settled' }),
  step('review-2', 'reviewer', 'Review 2', GraphNodeState.Done, { corner: '2m', outcome: '1 finding', warn: true }),
  step('settle-2', 'lead', 'Settle', GraphNodeState.Now, { corner: '7m' }),
  step('review-3', 'reviewer', 'Review 3', GraphNodeState.Next, { corner: 'next' }),
  step('publish', 'althar', 'Pull request', GraphNodeState.Next, { corner: 'next' }),
]

const report = (id: string) => <p style={{ margin: 0 }}>{`The report of ${id}: what it found, what it did, and its summary.`}</p>

const frame: CSSProperties = { height: 460, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }

const meta = {
  title: 'Thread/StepGraph',
  component: StepGraph,
  args: { lanes: LANES, rounds: [ASKED], steps: SIMPLE, detail: report, onRound: fn() },
  decorators: [(Story) => <div style={frame}>{Story()}</div>],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof StepGraph>
export default meta
type Story = StoryObj<typeof meta>

/** Implemented, reviewed, settled, reviewed again, its pull request open: everything done, the whole task in view. */
export const Simple: Story = {}

/** The review loop: the lead and the reviewer hand the work back and forth; the lead settles the second review. */
export const ReviewLoop: Story = { args: { steps: LOOP } }

/** A command waits for the person to allow it, mid-step: the step, and the line into it, in their colour. */
export const AsksYou: Story = {
  args: {
    steps: [
      step('implement', 'lead', 'Implement', GraphNodeState.Waiting, { corner: 'asks you', outcome: 'A command to allow' }),
      step('review-1', 'reviewer', 'Review 1', GraphNodeState.Next, { corner: 'next' }),
      step('publish', 'althar', 'Pull request', GraphNodeState.Next, { corner: 'next' }),
    ],
  },
}

/** Its review waits for a free place among the agents this machine runs at once. */
export const WaitsForAnAgent: Story = {
  args: {
    steps: [
      step('implement', 'lead', 'Implement', GraphNodeState.Done, { corner: '18m' }),
      step('review-1', 'reviewer', 'Review 1', GraphNodeState.Held, { corner: 'waits for an agent' }),
      step('publish', 'althar', 'Pull request', GraphNodeState.Next, { corner: 'next' }),
    ],
  },
}

/** A follow-up whose review never reported: it needs the person. */
export const Stuck: Story = {
  args: {
    rounds: [ASKED, FOLLOWED],
    steps: [
      ...SIMPLE,
      step('follow-up', 'lead', 'Follow-up', GraphNodeState.Done, { round: 'r2', corner: '19m' }),
      step('review-3', 'reviewer', 'Review 1', GraphNodeState.Waiting, { round: 'r2', corner: 'stuck', outcome: 'Needs you' }),
    ],
  },
}

/** Its pull request merged; a message sent it back to work, which ships again in a new pull request. */
export const BackAfterMerge: Story = {
  args: {
    rounds: [ASKED, { ...FOLLOWED, after: '2 days later' }],
    steps: [
      ...SIMPLE.slice(0, 4),
      step('publish', 'althar', 'Pull request', GraphNodeState.Done, { corner: '9s', outcome: '#229 merged' }),
      step('follow-up', 'lead', 'Follow-up', GraphNodeState.Now, { round: 'r2', corner: '3m' }),
      step('review-3', 'reviewer', 'Review 1', GraphNodeState.Next, { round: 'r2', corner: 'next' }),
      step('publish-2', 'althar', 'Pull request', GraphNodeState.Next, { round: 'r2', corner: 'next' }),
    ],
  },
}

/** A quick task made a change mid-work: what the change put in is dashed in cobalt until it runs, and its marker says so. */
export const StepsChanged: Story = {
  args: {
    rounds: [{ ...ASKED, changed: 'Review and Pull request added' }],
    steps: [
      step('implement', 'lead', 'Implement', GraphNodeState.Now, { corner: '1m' }),
      step('review-1', 'reviewer', 'Review 1', GraphNodeState.Added, { corner: 'added' }),
      step('publish', 'althar', 'Pull request', GraphNodeState.Added, { corner: 'added' }),
    ],
  },
}

/** Reviewed three times with a finding still open: a fourth review needs the person’s say, answered in its popover. */
export const ChangeAsksYou: Story = {
  args: {
    steps: [
      ...LOOP.slice(0, 4),
      step('settle-2', 'lead', 'Settle', GraphNodeState.Done, { corner: '1m', outcome: '1 settled' }),
      step('review-3', 'reviewer', 'Review 3', GraphNodeState.Done, { corner: '1m', outcome: '1 finding', warn: true }),
      step('settle-3', 'lead', 'Settle', GraphNodeState.Done, { corner: '1m', outcome: '1 settled' }),
      step('review-4', 'reviewer', 'Review 4', GraphNodeState.Proposed, { corner: 'your say', outcome: 'Needs you' }),
      step('publish', 'althar', 'Pull request', GraphNodeState.Next, { corner: 'next' }),
    ],
  },
}

/** Without reports to open, a card is no control, and a marker without a way to the conversation only shows what was said. */
export const NothingToOpen: Story = {
  args: { detail: undefined, onRound: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /Implement/ })).toBeNull()
    await expect(c.queryByRole('button', { name: /You asked/ })).toBeNull()
  },
}

/** A card opens its report beside it, and Escape closes it again, giving focus back to the card. */
export const OpensAReport: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const card = await c.findByRole('button', { name: /Review 1/ })
    await userEvent.click(card)
    const panel = await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Review 1' })
    await expect(panel).toHaveTextContent('The report of review-1')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).toBeNull())
    await expect(card).toHaveFocus()
  },
}

/** A marker goes to what started its round, in the conversation. */
export const GoesToWhatWasSaid: Story = {
  args: { rounds: [ASKED, FOLLOWED], steps: BackAfterMerge.args?.steps ?? [] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: /You followed up/ }))
    await expect(args.onRound).toHaveBeenCalledWith('r2')
  },
}

/** The canvas moves from its own keys: plus zooms in and minus out again, and the zoom it is at is said. */
export const Keyboard: Story = {
  args: { steps: LOOP },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const canvas = await c.findByRole('region', { name: 'The task’s steps' })
    canvas.focus()
    const percent = () => within(c.getByRole('group', { name: 'Zoom' })).getByText(/%$/).textContent
    const before = percent()
    await userEvent.keyboard('+')
    await waitFor(() => expect(percent()).not.toBe(before))
    await userEvent.keyboard('-')
    await waitFor(() => expect(percent()).toBe(before))
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        {
          state: 'simple',
          node: (
            <div style={frame}>
              <StepGraph {...args} />
            </div>
          ),
        },
        {
          state: 'review loop',
          node: (
            <div style={frame}>
              <StepGraph {...args} steps={LOOP} />
            </div>
          ),
        },
        {
          state: 'asks you',
          node: (
            <div style={frame}>
              <StepGraph {...args} {...AsksYou.args} />
            </div>
          ),
        },
        {
          state: 'waits for an agent',
          node: (
            <div style={frame}>
              <StepGraph {...args} {...WaitsForAnAgent.args} />
            </div>
          ),
        },
        {
          state: 'stuck',
          node: (
            <div style={frame}>
              <StepGraph {...args} {...Stuck.args} />
            </div>
          ),
        },
        {
          state: 'back after merge',
          node: (
            <div style={frame}>
              <StepGraph {...args} {...BackAfterMerge.args} />
            </div>
          ),
        },
        {
          state: 'steps changed',
          node: (
            <div style={frame}>
              <StepGraph {...args} {...StepsChanged.args} />
            </div>
          ),
        },
        {
          state: 'change asks you',
          node: (
            <div style={frame}>
              <StepGraph {...args} {...ChangeAsksYou.args} />
            </div>
          ),
        },
        {
          state: 'nothing to open',
          node: (
            <div style={frame}>
              <StepGraph {...args} detail={undefined} onRound={undefined} />
            </div>
          ),
        },
      ]}
    />
  ),
  decorators: [(Story) => <>{Story()}</>],
}
