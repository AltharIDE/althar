import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { SmallChange, type SmallChangeProps, type SmallChangeStep } from './SmallChange'

const STEPS: ReadonlyArray<SmallChangeStep> = [
  { key: 'started', what: 'Started', at: '2026-11-06T14:02:00', done: true },
  { key: 'changed', what: 'Changed 1 line in RunMenu.tsx', at: '2026-11-06T14:03:00', done: true },
  { key: 'checks', what: 'Checks pass', at: '2026-11-06T14:05:00', done: true },
  { key: 'merged', what: 'Merged', at: null, done: false },
]

const meta = {
  title: 'Thread/SmallChange',
  component: SmallChange,
  decorators: [threadDecorator],
  args: {
    title: 'The Run menu says Strat',
    model: 'Sonnet 5.5',
    skips: ['no plan', 'reviewed after it merges'],
    steps: STEPS,
    change: { name: 'PR #641', state: 'open' },
    onMerge: fn(),
    onMakeFullTask: fn(),
  },
} satisfies Meta<typeof SmallChange>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing waits but Merge: it says what it skipped, each step with its time. */
export const Opened: Story = {}

/** Merged, its review read afterwards: the merge's time and where the review went. */
export const Merged: Story = {
  args: {
    steps: STEPS.map((step) => (step.key === 'merged' ? { ...step, at: '2026-11-06T14:06:00', done: true } : step)),
    change: { name: 'PR #641', state: 'merged' },
    review: { title: 'Review #641: The Run menu says Strat', onOpen: fn() },
  },
}

/** Its checks failed: the person sees where it stopped, and Merge isn't offered. */
export const ChecksFailed: Story = {
  args: {
    steps: STEPS.map((step) => (step.key === 'checks' ? { ...step, what: 'Checks failed', done: false } : step)),
  },
}

/** Made a full task: the card folds to one line, and the review now runs before the merge. */
export const MadeFullTask: Story = {
  args: { fullTask: true, review: { title: 'Review #641: The Run menu says Strat', onOpen: fn() } },
}

/** Merge still asks, as every merge does; pressing it here shows the card as it comes back. */
function MergingCard(args: SmallChangeProps) {
  const [merged, setMerged] = useState(false)
  return (
    <SmallChange
      {...args}
      busy={merged}
      steps={
        merged ? args.steps.map((step) => (step.key === 'merged' ? { ...step, at: '2026-11-06T14:06:00', done: true } : step)) : args.steps
      }
      change={merged ? { name: 'PR #641', state: 'merged' } : args.change}
      onMerge={() => setMerged(true)}
    />
  )
}

export const Merging: Story = {
  render: (args) => <MergingCard {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Merge' }))
    await expect(c.getByText('Merged PR #641')).toBeInTheDocument()
  },
}

/** Make it a full task, in the head: the review comes before the merge instead of after. */
export const MakesItFull: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Make it a full task' }))
    await expect(args.onMakeFullTask).toHaveBeenCalled()
  },
}

/** Its title opens the task. */
export const OpensTheTask: Story = {
  args: { onOpen: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'The Run menu says Strat' }))
    await expect(args.onOpen).toHaveBeenCalled()
  },
}

export type { SmallChangeProps }
