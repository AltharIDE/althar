import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { Moments } from '../parts/Moments'
import { liveOf, momentsOf } from '../parts/sheet'
import { draw, NOTES } from './draw'

/*
 * A. Plan-like card. The checkpoint is a card in the thread, drawn like the
 * plan card the coordinator shows before a task starts: approach, numbered
 * assumptions with No on each, the plan's clock with Hold and Continue now.
 * The running card says where it is and how long is left.
 */

const meta = {
  title: 'Explorations/Triage checkpoint/A. Plan-like card',
  parameters: { layout: 'padded', controls: { disable: true } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The clock runs: correct one, hold it, carry on; then answer the question. */
export const Try: Story = {
  render: () => <Moments moments={liveOf(draw)} live />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const live = within(c.getByRole('region', { name: 'Try it' }))
    await userEvent.click(live.getByRole('button', { name: 'No, correct assumption 1' }))
    await expect(live.getByText('Paused while you write')).toBeInTheDocument()
    await userEvent.type(live.getByRole('textbox', { name: /instead/ }), 'Refunds get their own budget{Enter}')
    await expect(live.getByText(/Refunds get their own budget/)).toBeInTheDocument()
    await userEvent.click(live.getByRole('button', { name: 'Hold' }))
    await expect(live.getByText('Held. Continues when you say')).toBeInTheDocument()
    await expect(live.getByText('Checkpoint · held by you')).toBeInTheDocument()
    await userEvent.click(live.getByRole('button', { name: 'Continue' }))
    await expect(live.getByRole('button', { name: /Assumed 3 things, 1 corrected by you/ })).toBeInTheDocument()

    const asked = within(c.getByRole('region', { name: 'Try a question' }))
    await expect(asked.getByText('Waiting on you')).toBeInTheDocument()
    await userEvent.click(asked.getByRole('radio', { name: /Refuse with 429/ }))
    await userEvent.click(asked.getByRole('button', { name: /Answer/ }))
    await expect(asked.queryByText('Waiting on you')).not.toBeInTheDocument()
  },
}

/** Every moment, on paper. */
export const Light: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} /> }

/** Every moment, in the exploration's provisional dark. */
export const Dark: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} dark /> }
