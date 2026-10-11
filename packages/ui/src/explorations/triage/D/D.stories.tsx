import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { Moments } from '../parts/Moments'
import { liveOf, momentsOf } from '../parts/sheet'
import { draw, NOTES } from './draw'

/*
 * D. On the brief. What the lead assumes is mostly a reading of what you
 * asked for, so it is shown on your words: the phrases it read into are
 * marked, and its readings sit under the brief at the head of the thread,
 * each with the words it reads, or the file it is about, and No.
 */

const meta = {
  title: 'Explorations/Triage checkpoint/D. On the brief',
  parameters: { layout: 'padded', controls: { disable: true } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The clock runs: correct a reading, hold it, carry on; then answer the question. */
export const Try: Story = {
  render: () => <Moments moments={liveOf(draw)} live />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const live = within(c.getByRole('region', { name: 'Try it' }))
    const brief = within(live.getByRole('region', { name: /What you asked/ }))
    await expect(brief.getByText('the way charges are')).toBeInTheDocument()
    await userEvent.click(brief.getByRole('button', { name: 'No, correct assumption 1' }))
    await userEvent.type(brief.getByRole('textbox', { name: /instead/ }), 'Refunds get their own budget{Enter}')
    await expect(brief.getByText('· 1 corrected')).toBeInTheDocument()
    await userEvent.click(brief.getByRole('button', { name: 'Hold' }))
    await userEvent.click(brief.getAllByRole('button', { name: 'Continue' })[0] ?? document.body)
    await expect(brief.getByText('Took it to mean 3 things')).toBeInTheDocument()
  },
}

/** Every moment, on paper. */
export const Light: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} /> }

/** Every moment, in the exploration's provisional dark. */
export const Dark: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} dark /> }
