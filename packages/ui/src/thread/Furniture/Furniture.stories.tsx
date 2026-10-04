import type { Meta, StoryObj } from '@storybook/react-vite'

import { PROJECT } from '../../fixtures/meridian'
import { CODEX, GEMINI_PRO, OPUS } from '../../fixtures/models'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Prose, Turn } from '../Turn/Turn'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Interrupted, JumpToLatest, LeadLine, LimitMoved, ModelSwap, Restarted, ThreadDivider, ThreadEmpty } from './Furniture'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Furniture',
  component: ThreadDivider,
  decorators: [threadDecorator],
  args: { icon: 'compress', children: 'Earlier turns summarised · 212k → 38k tokens', action: 'Show summary', onAction: fn() },
} satisfies Meta<typeof ThreadDivider>
export default meta
type Story = StoryObj<typeof meta>

export const ContextCompacted: Story = {}
/** You interrupted a turn with the composer's square; the task kept going. */
export const InterruptedByYou: Story = {
  render: () => (
    <Turn model={CODEX} at="20m ago">
      <Prose>
        Replaying the staging log now. The first 1,200 refunds match charges exactly; I am going to widen it to the full day and
      </Prose>
      <Interrupted />
    </Turn>
  ),
}
/** Althar restarted mid-task: it checks what already happened before carrying on. */
export const RestartedChecking: Story = { render: () => <Restarted checking /> }
/** Checked, and carried on: nothing was run twice. */
export const RestartedCarriedOn: Story = { render: () => <Restarted /> }
/** A usage limit the rule handled: the work moved. */
export const LimitHandled: Story = {
  render: () => <LimitMoved what="Security review" to={GEMINI_PRO} runtime="Claude Code" resets="14:00" project={PROJECT} />,
}
/** No other agent free: it waits. */
export const LimitWaits: Story = { render: () => <LimitMoved what="The lead" runtime="Claude Code" resets="14:00" project={PROJECT} /> }
export const EmptyThread: Story = {
  render: () => (
    <ThreadEmpty kicker="Task 432 · held before it started" title="Backfill idempotency keys on refunds created before PR 1184">
      You held the plan in the coordinator. Nothing has run yet; tell the lead how to start, or start it as planned.
    </ThreadEmpty>
  ),
}

/** The lead changed mid-thread. */
export const LeadChanged: Story = {
  render: () => <ModelSwap to={CODEX} note="picks up from the task’s record, not from Opus 5’s memory" />,
}

/** Who leads, once the task has started. A long reason is cut short; all of it is in the title. */
export const Lead: Story = {
  render: () => <LeadLine model={OPUS} why="src/refunds is money handling; led 8 tasks here, 7 merged after one review round" />,
}

const onJump = fn()

/** New below where you scrolled up to. */
export const NewBelow: Story = {
  render: () => <JumpToLatest count={3} onJump={onJump} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^3 new/ }))
    await expect(onJump).toHaveBeenCalled()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        {
          state: 'divider',
          node: (
            <ThreadDivider icon={args.icon} action="Show summary" onAction={() => {}}>
              {args.children}
            </ThreadDivider>
          ),
        },
        { state: 'divider, no action', node: <ThreadDivider icon={args.icon}>{args.children}</ThreadDivider> },
        {
          state: 'action, hover',
          force: 'hover',
          node: (
            <ThreadDivider icon={args.icon} action="Show summary" onAction={() => {}}>
              {args.children}
            </ThreadDivider>
          ),
        },
        {
          state: 'action, focus',
          force: 'focus',
          node: (
            <ThreadDivider icon={args.icon} action="Show summary" onAction={() => {}}>
              {args.children}
            </ThreadDivider>
          ),
        },
        { state: 'interrupted by you', node: <Interrupted /> },
        { state: 'restarted, checking', node: <Restarted checking /> },
        { state: 'restarted, carried on', node: <Restarted /> },
        {
          state: 'limit, moved',
          node: <LimitMoved what="Security review" to={GEMINI_PRO} runtime="Claude Code" resets="14:00" project={PROJECT} />,
        },
        { state: 'limit, waits', node: <LimitMoved what="The lead" runtime="Claude Code" resets="14:00" project={PROJECT} /> },
        { state: 'empty thread', node: <ThreadEmpty kicker="Task 432" title="Backfill idempotency keys" /> },
        { state: 'lead changed', node: <ModelSwap to={CODEX} note="picks up from the task’s record" /> },
        { state: 'lead changed, no note', node: <ModelSwap to={CODEX} /> },
        { state: 'lead', node: <LeadLine model={OPUS} why="money path across 3 files" /> },
        {
          state: 'lead, long reason',
          node: (
            <LeadLine
              model={OPUS}
              why="src/refunds is money handling; led 8 tasks here, 7 merged after one review round, and 60% of the week left"
            />
          ),
        },
        { state: 'new below', node: <JumpToLatest count={3} onJump={() => {}} /> },
        { state: 'scrolled up, nothing counted', node: <JumpToLatest onJump={() => {}} /> },
        { state: 'new below, hover', force: 'hover', node: <JumpToLatest count={12} onJump={() => {}} /> },
      ]}
    />
  ),
}
