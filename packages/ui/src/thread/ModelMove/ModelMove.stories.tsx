import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { ModelMove, type ModelMoveProps } from './ModelMove'

const meta = {
  title: 'Thread/ModelMove',
  component: ModelMove,
  decorators: [threadDecorator],
  args: {
    from: 'Opus 5.5',
    to: 'Sonnet 5.5',
    plan: 'Claude',
    percent: 92,
    window: 'the week',
    resetsAt: '2026-11-12T09:00:00',
    kept: false,
  },
} satisfies Meta<typeof ModelMove>
export default meta
type Story = StoryObj<typeof meta>

/** Auto moved the lead as the plan ran low: the move, why, and the way back. */
export const Moved: Story = { args: { onKeep: fn() } }

/** Kept at the heavier model for this task: one line, and Undo. */
function KeptLine(args: ModelMoveProps) {
  const [kept, setKept] = useState(true)
  return <ModelMove {...args} kept={kept} onUndo={() => setKept(false)} />
}

export const Kept: Story = {
  render: (args) => <KeptLine {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(c.getByText(/Moved to Sonnet 5.5/)).toBeInTheDocument()
  },
}

/** Keep Opus 5.5 turns it back for this task; the line says so, with Undo. */
function KeepingLine(args: ModelMoveProps) {
  const [kept, setKept] = useState(false)
  return <ModelMove {...args} kept={kept} onKeep={() => setKept(true)} onUndo={() => setKept(false)} />
}

export const Keeping: Story = {
  render: (args) => <KeepingLine {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Keep Opus 5.5' }))
    await expect(c.getByText('Back on Opus 5.5 for this task.')).toBeInTheDocument()
  },
}
