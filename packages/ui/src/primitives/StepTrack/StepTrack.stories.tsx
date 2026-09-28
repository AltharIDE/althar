import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { TaskStatus } from '../../foundations/vocabulary'
import { Button } from '../Button/Button'
import { States } from '../../storybook/States'
import { StepTrack, trackOf } from './StepTrack'

const STEPS = ['Triage', 'Implement', 'Review', 'Verify', 'Draft PR']

const meta = {
  title: 'Primitives/StepTrack',
  component: StepTrack,
  args: { steps: trackOf(STEPS, 2) },
  decorators: [(Story) => <div style={{ maxWidth: 420 }}>{Story()}</div>],
} satisfies Meta<typeof StepTrack>
export default meta
type Story = StoryObj<typeof meta>

/** On the third step, running. Without labels the names are read out, not shown. */
export const Running: Story = {}
export const Labelled: Story = { args: { labels: true } }
/** Sent back from Verify to Implement: the steps it had reached stay, faintly. */
export const SentBack: Story = { args: { steps: trackOf(STEPS, 1, 3), labels: true } }
export const WaitingOnYou: Story = { args: { status: TaskStatus.Yours, labels: true } }
export const Paused: Story = { args: { status: TaskStatus.Paused, labels: true } }
export const Stopped: Story = { args: { status: TaskStatus.Stopped, labels: true } }
export const Done: Story = { args: { steps: trackOf(STEPS, 4, 4, true), status: TaskStatus.Done, labels: true } }

/** A step finishing: its bar fills with ink from its start, and the next one takes the task's colour. A track that loads with steps already done doesn't fill. */
export const FinishingAStep: Story = {
  render: function Finishing(args) {
    const [at, setAt] = useState(1)
    return (
      <div style={{ display: 'grid', gap: 16, justifyItems: 'start' }}>
        <StepTrack {...args} steps={trackOf(STEPS, at)} labels />
        <Button onClick={() => setAt((n) => (n + 1) % STEPS.length)}>Finish the step</Button>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Finish the step' }))
    const step = (name: string) => c.getByText(name, { exact: false }).closest('li')?.textContent
    await expect(step('Implement')).toContain('done')
    await expect(step('Review')).toContain('now')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'running', node: <StepTrack steps={trackOf(STEPS, 2)} /> },
        { state: 'labelled', node: <StepTrack steps={trackOf(STEPS, 2)} labels /> },
        { state: 'sent back', node: <StepTrack steps={trackOf(STEPS, 1, 3)} labels /> },
        { state: 'waiting on you', node: <StepTrack steps={trackOf(STEPS, 2)} status={TaskStatus.Yours} labels /> },
        { state: 'paused', node: <StepTrack steps={trackOf(STEPS, 2)} status={TaskStatus.Paused} labels /> },
        { state: 'stopped', node: <StepTrack steps={trackOf(STEPS, 2)} status={TaskStatus.Stopped} labels /> },
        { state: 'done', node: <StepTrack steps={trackOf(STEPS, 4, 4, true)} status={TaskStatus.Done} labels /> },
        { state: 'just started', node: <StepTrack steps={trackOf(STEPS, 0)} labels fresh /> },
      ]}
    />
  ),
}
