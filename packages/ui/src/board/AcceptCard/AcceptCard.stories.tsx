import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { READY, READY_TWO_REPOS } from '../../fixtures/board'
import { States, statesOn } from '../../storybook/States'
import { cardStates, laneDecorator } from '../../storybook/lane'
import { AcceptCard } from './AcceptCard'

const meta = {
  title: 'Board/AcceptCard',
  component: AcceptCard,
  decorators: [laneDecorator],
  args: { ...READY, onOpen: fn() },
} satisfies Meta<typeof AcceptCard>
export default meta
type Story = StoryObj<typeof meta>

export const OneRepository: Story = {}
/** A change across two repositories: one pull request each, merged in order. */
export const TwoRepositories: Story = { args: READY_TWO_REPOS }
export const Current: Story = { args: { current: true } }
/** Work with no pull request, as where no code host is connected: its branch, and no checks. */
export const OnItsBranch: Story = {
  args: { prs: [], branch: { name: 'althar/add-a-retry', add: 48, del: 9 }, checks: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('althar/add-a-retry')).toBeInTheDocument()
    await expect(within(canvasElement).queryByText(/checks? passed/)).not.toBeInTheDocument()
  },
}
/** A pull request no checks ran on. */
export const NoChecks: Story = {
  args: { checks: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No checks ran')).toBeInTheDocument()
  },
}

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: READY.title }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn(cardStates),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'one repository', node: <AcceptCard {...args} /> },
        { state: 'two repositories', node: <AcceptCard {...args} {...READY_TWO_REPOS} /> },
        { state: 'current', node: <AcceptCard {...args} current /> },
        { state: 'nothing opens it', node: <AcceptCard {...args} onOpen={undefined} /> },
        { state: 'hover', node: <AcceptCard {...args} /> },
        { state: 'focus', node: <AcceptCard {...args} /> },
      ]}
    />
  ),
}
