import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { RoundsPreview } from './RoundsPreview'
import { TASK_PREVIEW_SEAL } from './samples'

const meta = {
  title: 'Setup/TaskPreviews/RoundsPreview',
  component: RoundsPreview,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 440 }}>{Story()}</div>],
  args: { rounds: 3, out: 'settled', facts: TASK_PREVIEW_SEAL },
} satisfies Meta<typeof RoundsPreview>
export default meta
type Story = StoryObj<typeof meta>

const seals = (canvasElement: HTMLElement) => canvasElement.querySelectorAll('figure img')

/** Three rounds, as tasks have by default: a seal each, then it goes on once every finding is settled. */
export const ThreeRounds: Story = {
  play: async ({ canvasElement }) => {
    const review = within(canvasElement).getByRole('figure', { name: 'Rounds of review' })
    await expect(review).toHaveTextContent('up to 3 rounds')
    await expect(review).toHaveTextContent('Goes on, once every finding is settled')
    await expect(seals(canvasElement)).toHaveLength(3)
  },
}

export const OneRound: Story = {
  args: { rounds: 1 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('figure')).toHaveTextContent('up to 1 round')
    await expect(seals(canvasElement)).toHaveLength(1)
  },
}

export const TwoRounds: Story = {
  args: { rounds: 2 },
  play: async ({ canvasElement }) => {
    await expect(seals(canvasElement)).toHaveLength(2)
  },
}

export const FiveRounds: Story = {
  args: { rounds: 5 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('figure')).toHaveTextContent('up to 5 rounds')
    await expect(seals(canvasElement)).toHaveLength(5)
  },
}

/** Once they run out, it asks the person: said in violet, as what waits on them. */
export const AsksYou: Story = {
  args: { out: 'ask' },
  play: async ({ canvasElement }) => {
    const review = within(canvasElement).getByRole('figure')
    await expect(within(review).getByText('Asks you')).toBeInTheDocument()
    await expect(review).not.toHaveTextContent('settled')
  },
}

export const Dark: Story = { ...ThreeRounds, globals: { theme: 'dark' } }
export const AsksYouDark: Story = { ...AsksYou, globals: { theme: 'dark' } }

/** Five rounds and asking, in the narrowest sheet: what follows the seals wraps under them. */
export const Narrow: Story = {
  args: { rounds: 5, out: 'settled' },
  decorators: [(Story) => <div style={{ width: 320 }}>{Story()}</div>],
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: '1 round', node: <RoundsPreview rounds={1} out="settled" facts={TASK_PREVIEW_SEAL} /> },
        { state: '2 rounds', node: <RoundsPreview rounds={2} out="settled" facts={TASK_PREVIEW_SEAL} /> },
        { state: '3 rounds', node: <RoundsPreview rounds={3} out="settled" facts={TASK_PREVIEW_SEAL} /> },
        { state: '5 rounds', node: <RoundsPreview rounds={5} out="settled" facts={TASK_PREVIEW_SEAL} /> },
        { state: 'asks you', node: <RoundsPreview rounds={3} out="ask" facts={TASK_PREVIEW_SEAL} /> },
      ]}
    />
  ),
}
