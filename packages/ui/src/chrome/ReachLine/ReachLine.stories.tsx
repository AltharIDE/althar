import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { OUTSIDE_REACH } from '../../fixtures/reviews'
import { States } from '../../storybook/States'
import { ReachLine } from './ReachLine'

const meta = {
  title: 'Chrome/ReachLine',
  component: ReachLine,
  args: { phrases: OUTSIDE_REACH },
} satisfies Meta<typeof ReachLine>
export default meta
type Story = StoryObj<typeof meta>

/** A review of a pull request from outside: what its lead reads, runs, reaches and posts. */
export const Outside: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    for (const phrase of OUTSIDE_REACH) await expect(c.getByRole('button', { name: phrase.words })).toBeInTheDocument()
  },
}

/** A phrase opens what it means; Escape closes it, and focus goes back to the phrase. */
export const OpensWhatItMeans: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const network = c.getByRole('button', { name: 'no network' })
    await userEvent.click(network)
    const body = within(document.body)
    await waitFor(() => expect(body.getByRole('dialog', { name: 'no network' })).toBeInTheDocument())
    await expect(body.getByText(/The agent has no network, and Althar refuses its fetches/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
    await expect(network).toHaveFocus()
  },
}

/** One phrase's meaning open from the start. */
export const OneOpen: Story = { args: { defaultOpen: 'runs' } }

/** A team's pull request, which its lead reads with the network. */
export const Team: Story = {
  args: {
    phrases: OUTSIDE_REACH.filter((phrase) => phrase.id !== 'network').map((phrase) => ({
      ...phrase,
      words: phrase.words.replace('ninemate', 'ana'),
    })),
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'outside', node: <ReachLine {...args} /> },
        { state: 'a team’s', node: <ReachLine {...args} phrases={OUTSIDE_REACH.filter((phrase) => phrase.id !== 'network')} /> },
        { state: 'one phrase', node: <ReachLine {...args} phrases={OUTSIDE_REACH.slice(0, 1)} /> },
      ]}
    />
  ),
}
