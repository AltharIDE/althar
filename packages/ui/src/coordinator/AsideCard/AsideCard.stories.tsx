import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { T432 } from '../../fixtures/coordinator'
import { TaskStatus } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Thread } from '../../thread/Thread/Thread'
import { Prose, Turn } from '../../thread/Turn/Turn'
import { You } from '../../thread/You/You'
import { TaskCard } from '../TaskCard/TaskCard'
import { AsideCard, AsideState } from './AsideCard'

const meta = {
  title: 'Coordinator/AsideCard',
  component: AsideCard,
  decorators: [threadDecorator],
  args: {
    task: 'a-17',
    title: 'What the release script does with tags',
    state: AsideState.Running,
    result: 'Reading scripts/release.ts and the workflow that calls it',
    onOpen: fn(),
  },
} satisfies Meta<typeof AsideCard>
export default meta
type Story = StoryObj<typeof meta>

/** At work: what its lead is at, quiet, and a way to open it beside the coordinator. No steps: an aside has none. */
export const Running: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Aside on Scratch')).toBeVisible()
    await expect(c.queryByText('Implement')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: /Open aside/ }))
    await expect(args.onOpen).toHaveBeenCalledWith('a-17')
  },
}

/** Done: its result up front, a few lines at most. */
export const Ready: Story = {
  args: {
    state: AsideState.Ready,
    result:
      'It tags from package.json’s version, then pushes the tag with --follow-tags, which starts the release workflow. Nothing else reads the tags; a tag pushed by hand starts the same run.',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/It tags from package.json/)).toBeVisible()
  },
}

/** Its lead ended before it finished: said in the danger colour, with its last words where it left some, and the way back in. */
export const Failed: Story = {
  args: { state: AsideState.Failed, result: 'Claude Code is signed out.' },
}

/** Failed with nothing said: the card says what to do. */
export const FailedSilently: Story = {
  args: { state: AsideState.Failed, result: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Open it to try again/)).toBeVisible()
  },
}

/** Something in it waits on you: violet, and the button answers. */
export const NeedsYou: Story = {
  args: { state: AsideState.Yours, result: 'May I read ~/.npmrc to see which registry it publishes to?' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /Answer/ })).toBeVisible()
  },
}

/** Waiting to begin, here for the checkout it works in. */
export const Waiting: Story = {
  args: { state: AsideState.Waiting, result: 'Waits for Local: Fix the login loop is there' },
}

/** Begun, held up: a lost connection it tries again. */
export const Paused: Story = {
  args: { state: AsideState.Paused, result: 'Anthropic failed: trying again at 19:45' },
}

/** Done, and kept for later by the person: its result still up front. */
export const Kept: Story = {
  args: { state: AsideState.Kept, result: Ready.args?.result },
}

export const Stopped: Story = {
  args: { state: AsideState.Stopped, result: 'Stopped when you interrupted it' },
}

/** In the coordinator's thread, after a task's card: plainly not one. */
export const InTheThread: Story = {
  decorators: [],
  parameters: { layout: 'padded' },
  render: (args) => (
    <div style={{ maxWidth: 720 }}>
      <Thread label="Conversation">
        <You at="19:20">Backfill the idempotency keys on old refunds. And quickly: what does the release script do with tags?</You>
        <Turn voice="Coordinator" at="19:20">
          <Prose>The backfill is a task, on the board. The tags question is an aside on Scratch.</Prose>
        </Turn>
        <TaskCard
          {...T432}
          status={TaskStatus.Running}
          at={0}
          now="Implement · writing the backfill script"
          started="4m ago"
          onOpen={fn()}
        />
        <AsideCard {...args} {...Ready.args} />
      </Thread>
    </div>
  ),
}

/** Every state at the narrowest and widest the chat gives it, with a long title: the kicker and title give way, the state never. */
export const Widths: Story = {
  parameters: { layout: 'padded' },
  decorators: [],
  render: (args) => {
    const long = 'What the release script does with tags, and whether anything else in CI reads them before publishing'
    const cards = [
      args,
      { ...args, ...Ready.args, title: long },
      { ...args, ...Failed.args },
      { ...args, ...NeedsYou.args },
      { ...args, ...Stopped.args },
    ]
    return (
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
        {[320, 720].map((w) => (
          <div key={w} style={{ width: w, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {cards.map((card, i) => (
              <AsideCard key={i} {...card} />
            ))}
          </div>
        ))}
      </div>
    )
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'running', node: <AsideCard {...args} /> },
        { state: 'ready', node: <AsideCard {...args} {...Ready.args} /> },
        { state: 'failed', node: <AsideCard {...args} {...Failed.args} /> },
        { state: 'failed, nothing said', node: <AsideCard {...args} {...FailedSilently.args} /> },
        { state: 'needs you', node: <AsideCard {...args} {...NeedsYou.args} /> },
        { state: 'waiting', node: <AsideCard {...args} {...Waiting.args} /> },
        { state: 'paused', node: <AsideCard {...args} {...Paused.args} /> },
        { state: 'kept for later', node: <AsideCard {...args} {...Kept.args} /> },
        { state: 'stopped', node: <AsideCard {...args} {...Stopped.args} /> },
        { state: 'no way in', node: <AsideCard {...args} onOpen={undefined} /> },
        { state: 'open, hover', force: 'hover', node: <AsideCard {...args} /> },
        { state: 'open, focus', force: 'focus', node: <AsideCard {...args} /> },
      ]}
    />
  ),
}
