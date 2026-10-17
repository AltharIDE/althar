import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { UsageNotice } from './UsageNotice'

const meta = {
  title: 'Chrome/UsageNotice',
  component: UsageNotice,
  args: { account: 'Codex · work', which: '5-hour window', left: 25, until: '17:00', onSeen: fn(), onOpen: fn() },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}>{Story()}</div>],
} satisfies Meta<typeof UsageNotice>
export default meta
type Story = StoryObj<typeof meta>

/** A quarter of the 5-hour window is left. */
export const Quarter: Story = {}

export const Half: Story = { args: { left: 50 } }
export const Tenth: Story = { args: { left: 10 } }
export const Twentieth: Story = { args: { left: 5, account: 'Claude Code · personal', which: 'weekly window', until: 'Fri 9:00 AM' } }

/** The source gave no reset time. */
export const NoResetTime: Story = { args: { until: null } }

/** Each threshold's tone, side by side. */
export const AllTones: Story = {
  render: () => (
    <States
      size="thread"
      cells={[50, 25, 10, 5].map((left) => ({
        state: `${left}% left`,
        node: <UsageNotice account="Codex · work" which="5-hour window" left={left} until="17:00" onSeen={() => {}} onOpen={() => {}} />,
      }))}
    />
  ),
}

/** Seen takes it away; Open usage opens the view. */
export const Answering: Story = {
  play: async ({ args, canvasElement }) => {
    const notice = within(canvasElement).getByRole('region', { name: 'Plan usage' })
    await expect(within(notice).getByRole('status')).toHaveTextContent('Codex · work: 25% of the 5-hour window is left, until 17:00.')
    await userEvent.click(within(notice).getByRole('button', { name: 'Open usage' }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
    await userEvent.click(within(notice).getByRole('button', { name: 'Seen' }))
    await expect(args.onSeen).toHaveBeenCalledOnce()
  },
}
