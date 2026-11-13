import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { SmallChange, type SmallChangeProps, type SmallChangeReviewWhen } from './SmallChange'

const at = (time: string) => `2026-11-06T${time}:00`
const CHANGED = { at: at('14:03'), words: '6 files' }
const PASSED = { state: 'passed', passed: 5, total: 5, failing: null, at: at('14:12') } as const
const WAITING = { state: 'waiting', at: null } as const
const AFTER = { when: 'after', state: 'waiting', findings: 0, at: null } as const

const meta = {
  title: 'Thread/SmallChange',
  component: SmallChange,
  decorators: [threadDecorator],
  args: {
    title: 'Usage card drops the time breakdown',
    started: at('13:58'),
    changed: CHANGED,
    checks: PASSED,
    merge: { state: 'ready', at: null },
    review: AFTER,
    explain:
      'Starts at once on Sonnet 5.5, with no plan. You merge it; GPT-6.1 Sol then reads what merged, and only something major comes back here.',
    onMerge: fn(),
    onReview: fn(),
    onFindings: fn(),
  },
} satisfies Meta<typeof SmallChange>
export default meta
type Story = StoryObj<typeof meta>

/** Its configured reviewer reads before Ship; size offers no extra after-merge review. */
export const BeforeShip: Story = {
  args: {
    review: { when: 'before', state: 'clear', findings: 0, at: at('14:08') },
    onReview: undefined,
    text: { fullTask: 'Small change', clear: 'Reviewed before Ship' },
    explain: 'Starts at once on Sonnet 5.5. GPT-6.1 Sol reads the change before Ship.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Small change')).toBeInTheDocument()
    await expect(canvas.getByText('Reviewed before Ship')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Review' })).toBeNull()
    await expect(canvas.queryByText('After merge')).toBeNull()
  },
}

/** Just started: its lead is at the change. */
export const Started: Story = {
  args: { changed: { at: null, words: null }, checks: { ...PASSED, state: 'waiting', at: null }, merge: WAITING },
}

/** Its checks run: how many have passed of all. */
export const ChecksRunning: Story = {
  args: { checks: { state: 'running', passed: 3, total: 5, failing: null, at: null }, merge: WAITING },
}

/** A check failed: which, in red; Merge isn't offered. */
export const ChecksFailed: Story = {
  args: { checks: { state: 'failed', passed: 4, total: 5, failing: 'types', at: null }, merge: WAITING },
}

/** Ready: Merge, the one thing that waits on the person, with its size. */
export const Ready: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Merge' }))
    await expect(args.onMerge).toHaveBeenCalled()
  },
}

/** In its target's merge queue. */
export const Queued: Story = { args: { merge: { state: 'queued', at: null } } }

/** Merged, and its review reads what merged. */
export const Reviewing: Story = {
  args: { merge: { state: 'merged', at: at('14:15') }, review: { ...AFTER, state: 'running' } },
}

/** Its review found nothing the project's rule brings back. */
export const NothingMajor: Story = {
  args: { merge: { state: 'merged', at: at('14:15') }, review: { ...AFTER, state: 'quiet', findings: 2, at: at('14:24') } },
}

/** What it found waits on the person: a way to it, in the thread. */
export const Found: Story = {
  args: { merge: { state: 'merged', at: at('14:15') }, review: { ...AFTER, state: 'found', findings: 2, at: at('14:27') } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'See findings' }))
    await expect(args.onFindings).toHaveBeenCalled()
  },
}

/** Made a full task: its review moved before Merge. */
export const FullTask: Story = {
  args: {
    review: { ...AFTER, when: 'before' },
    checks: { state: 'running', passed: 3, total: 5, failing: null, at: null },
    merge: WAITING,
  },
}

/** Pressing Review moves it before the merge, keeps it after, or takes it off; taken off, the route ends at Merge. */
export const Choosing: Story = {
  render: function Render(args: SmallChangeProps) {
    const [when, setWhen] = useState<SmallChangeReviewWhen>('after')
    return (
      <SmallChange
        {...args}
        review={{ ...args.review, when }}
        onReview={(next) => {
          args.onReview?.(next)
          setWhen(next)
        }}
      />
    )
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Review' }))
    await userEvent.click(await within(document.body).findByRole('menuitemradio', { name: /No review/ }))
    await expect(args.onReview).toHaveBeenCalledWith('none')
    await expect(canvas.queryByText('After merge')).toBeNull()
  },
}

/** No review after it merges, by its rule or its own word: the route ends at Merge, and Review comes back from a pointer. */
export const NoReview: Story = {
  args: { review: { ...AFTER, when: 'none' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('After merge')).toBeNull()
    await expect(within(canvasElement).getByRole('button', { name: 'Review' })).toBeTruthy()
  },
}

/** The person left what it found as it is; its lead fixing it reads Being fixed. */
export const LeftAsIs: Story = {
  args: { merge: { state: 'merged', at: at('14:15') }, review: { ...AFTER, state: 'left', findings: 2, at: at('14:31') }, onOpen: fn() },
}
