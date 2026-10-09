import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { EDGE_NEEDS, EDGE_WORK, type EdgeDemoRow, edgeRowOf, NOTCH } from '../../fixtures/edge'
import { EdgeSheet } from '../EdgeSheet/EdgeSheet'
import { Island } from './Island'
import s from './Island.stories.module.css'

const rowOf = (row: EdgeDemoRow) => edgeRowOf(row, fn())

const sheet = (
  <EdgeSheet
    tone="ink"
    waiting={EDGE_NEEDS.length}
    working={EDGE_WORK.length}
    needs={EDGE_NEEDS.map(rowOf)}
    work={EDGE_WORK.map(rowOf)}
    onOpenApp={fn()}
  />
)

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
  args: { notch: NOTCH, waiting: 2, running: 3, children: sheet, onOpenApp: fn() },
} satisfies Meta<typeof Island>
export default meta
type Story = StoryObj<typeof meta>

/** Two calls wait on you: violet, and ringing. Pointed at, it drops open. */
export const NeedsYou: Story = {}

/** Only work in progress: cobalt and still, with how many run. */
export const OnlyRunning: Story = { args: { waiting: 0 } }

/** Nothing going on: the notch alone. Pointed at, it still opens. */
export const Quiet: Story = { args: { waiting: 0, running: 0 } }

/** A call has just come in: the island widens with whose it is and what kind, until the app clears it. */
export const Saying: Story = { args: { saying: { project: 'Halyard', kind: 'Permission' } } }

/** Open: the home in small, answered in place. */
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
