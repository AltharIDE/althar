import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { EDGE_NEEDS, EDGE_WORK, type EdgeDemoCall, edgeLineOf, NOTCH } from '../../fixtures/edge'
import { HALYARD } from '../../fixtures/home'
import { EdgeSheet } from '../EdgeSheet/EdgeSheet'
import { Island } from './Island'
import s from './Island.stories.module.css'

const lineOf = (call: EdgeDemoCall) => edgeLineOf(call, fn())

const sheet = <EdgeSheet tone="ink" waiting={EDGE_NEEDS.length} needs={EDGE_NEEDS.map(lineOf)} work={EDGE_WORK} onOpenApp={fn()} />

const meta = {
  title: 'Home/Island',
  component: Island,
  decorators: [
    (Story) => (
      <div className={s.screen}>
        <div className={s.menuBar} />
        {Story()}
      </div>
    ),
  ],
  args: { notch: NOTCH, waiting: 2, children: sheet, onOpenApp: fn() },
} satisfies Meta<typeof Island>
export default meta
type Story = StoryObj<typeof meta>

/** Two calls wait on you: short wings, the mark faint and a still violet count. Pointed at, it drops open. */
export const NeedsYou: Story = {}

/** Nothing waits on you, however much is in progress: the notch alone. Pointed at, it still opens. */
export const Quiet: Story = { args: { waiting: 0 } }

/** Many wait: the wings take the count's every digit. */
export const Many: Story = { args: { waiting: 12 } }

/** A call has just come in: whose by its project's mark, and what kind beside a ringing dot, until the app clears it. */
export const Saying: Story = { args: { saying: { project: HALYARD, kind: 'Permission' } } }

/** A longer kind widens the wings to fit it. */
export const SayingReady: Story = { args: { saying: { project: HALYARD, kind: 'Ready to accept' } } }

/** Open: what needs you, answered in place, and the work in one line. */
export const Open: Story = { args: { open: true } }

/** Pressing the count opens it from the keyboard, and again closes it. */
export const FromTheKeyboard: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(false)
    return <Island {...args} open={open} onOpenChange={setOpen} />
  },
  play: async ({ canvasElement }) => {
    const island = within(canvasElement)
    const count = island.getByRole('button', { name: '2 need you' })
    await userEvent.click(count)
    await expect(count).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(count)
    await expect(count).toHaveAttribute('aria-expanded', 'false')
  },
}
