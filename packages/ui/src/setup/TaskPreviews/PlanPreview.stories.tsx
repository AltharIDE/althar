import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { CODEX, OPUS } from '../../fixtures/models'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { States } from '../../storybook/States'
import type { Countdown } from '../PlansAndReviews/PlansAndReviews'
import { PlanPreview, type PlanPreviewSample } from './PlanPreview'
import { PLAN_PREVIEW_SAMPLE } from './samples'

/** The sample plan, with who runs each step as the consumer adds them from its models. */
const SAMPLE: PlanPreviewSample = {
  ...PLAN_PREVIEW_SAMPLE,
  steps: PLAN_PREVIEW_SAMPLE.steps.map((step) => ({ ...step, who: step.id === 'review' ? CODEX : OPUS })),
}

const meta = {
  title: 'Setup/TaskPreviews/PlanPreview',
  component: PlanPreview,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 440 }}>{Story()}</div>],
  args: { countdown: 25, sample: SAMPLE },
} satisfies Meta<typeof PlanPreview>
export default meta
type Story = StoryObj<typeof meta>

/** The default wait: the plan as the thread shows it, the time before it starts, and its buttons, as a picture nothing in which takes focus. */
export const TwentyFiveSeconds: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const plan = c.getByRole('figure', { name: 'A plan as the thread shows it' })
    await expect(plan).toHaveTextContent('Task DEV-212')
    await expect(plan).toHaveTextContent('Starts in 25s')
    await expect(within(plan).getAllByRole('listitem')).toHaveLength(3)
    // A picture of the buttons, out of the tab order and away from a screen reader.
    await expect(within(plan).queryByRole('button')).toBeNull()
    await userEvent.tab()
    await expect(plan.contains(document.activeElement)).toBe(false)
  },
}

export const TenSeconds: Story = {
  args: { countdown: 10 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('figure')).toHaveTextContent('Starts in 10s')
  },
}

export const OneMinute: Story = {
  args: { countdown: 60 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('figure')).toHaveTextContent('Starts in 60s')
  },
}

/** Right away: the plan has started; what would count down keeps its place, unseen. */
export const RightAway: Story = {
  args: { countdown: 0 },
  play: async ({ canvasElement }) => {
    const plan = within(canvasElement).getByRole('figure')
    await expect(plan).toHaveTextContent('Started')
    await expect(plan).not.toHaveTextContent(/Starts in/)
  },
}

export const Dark: Story = { ...TwentyFiveSeconds, globals: { theme: 'dark' } }

/** In a wide sheet, as Settings' Tasks has it beside the review. */
export const Wide: Story = {
  decorators: [(Story) => <div style={{ width: 640 }}>{Story()}</div>],
}

/** As the setting changes, the words and the ring change in place; the card keeps its height. */
function Changing() {
  const [countdown, setCountdown] = useState<Countdown>(25)
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Segmented<string>
        label="Start a plan after"
        value={String(countdown)}
        onChange={(next) => setCountdown(Number(next) as Countdown)}
        options={[0, 10, 25, 60].map((one) => ({ value: String(one), label: one === 0 ? 'Right away' : `${one}s` }))}
      />
      <PlanPreview countdown={countdown} sample={SAMPLE} />
    </div>
  )
}

export const ChangingTheSetting: Story = {
  render: () => <Changing />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const plan = c.getByRole('figure')
    const tall = plan.getBoundingClientRect().height
    await userEvent.click(c.getByRole('radio', { name: 'Right away' }))
    await expect(plan).toHaveTextContent('Started')
    await expect(plan.getBoundingClientRect().height).toBe(tall)
    await userEvent.click(c.getByRole('radio', { name: '60s' }))
    await expect(plan).toHaveTextContent('Starts in 60s')
    await expect(plan.getBoundingClientRect().height).toBe(tall)
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={([0, 10, 25, 60] as const).map((countdown) => ({
        state: countdown === 0 ? 'right away' : `${countdown} seconds`,
        node: <PlanPreview countdown={countdown} sample={SAMPLE} />,
      }))}
    />
  ),
}
