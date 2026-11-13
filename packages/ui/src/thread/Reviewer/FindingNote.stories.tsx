import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { REVIEW_FINDINGS, REVIEW_FINDINGS_SETTLED, REVIEW_KEPT } from '../../fixtures/reviewFindings'
import { States } from '../../storybook/States'
import { FindingNote } from './FindingNote'

const LONG = REVIEW_FINDINGS[2]!

const meta = {
  title: 'Thread/FindingNote',
  component: FindingNote,
  args: { finding: LONG, onPick: fn() },
  decorators: [(Story) => <div style={{ padding: 24, maxWidth: 760 }}>{Story()}</div>],
} satisfies Meta<typeof FindingNote>
export default meta
type Story = StoryObj<typeof meta>

/** A long one you're not on: its title, its first lines, and More for the rest; the title goes to it. */
export const Open: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'More' }))
    await expect(c.getByRole('button', { name: 'Less' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: LONG.title ?? '' }))
    await expect(args.onPick).toHaveBeenCalledWith(LONG.id)
  },
}

/** Fixed, with what changed and the commit. */
export const Fixed: Story = {
  args: { finding: REVIEW_FINDINGS_SETTLED[0]! },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('6c3783c')).toBeInTheDocument()
  },
}

/** Kept, with the lead's reason. */
export const Kept: Story = {
  args: { finding: REVIEW_KEPT },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Kept')).toBeInTheDocument()
  },
}

/** Without a title, as reviews before titles were: the claim's first sentence heads it, the rest under it. */
export const Untitled: Story = { args: { finding: { ...REVIEW_FINDINGS[0]!, title: null } } }

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'open', node: <FindingNote finding={LONG} /> },
        { state: 'current', node: <FindingNote finding={REVIEW_FINDINGS[0]!} current /> },
        { state: 'fixed', node: <FindingNote finding={REVIEW_FINDINGS_SETTLED[1]!} /> },
        { state: 'kept', node: <FindingNote finding={REVIEW_KEPT} /> },
      ]}
    />
  ),
}
