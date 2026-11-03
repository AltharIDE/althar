import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { NextStep, NextSteps } from './NextStep'

/* A card's strip, at a card's width: one step, two, words that lead into the task, and a step under way. */

const meta = {
  title: 'Primitives/NextStep',
  component: NextSteps,
  decorators: [(Story) => <div style={{ width: 300 }}>{Story()}</div>],
  args: { children: null },
} satisfies Meta<typeof NextSteps>
export default meta
type Story = StoryObj<typeof meta>

const push = fn()

/** The person's own to do, in violet, the strip's width. */
export const OneStep: Story = {
  render: () => (
    <NextSteps>
      <NextStep signal onPress={push} label="Push 1 commit to #402">
        Push 1 commit
      </NextStep>
    </NextSteps>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Push 1 commit to #402' }))
    await expect(push).toHaveBeenCalledOnce()
  },
}

/** Two side by side, a hairline between: the quiet one first, the violet one last. */
export const TwoSteps: Story = {
  render: () => (
    <NextSteps>
      <NextStep onPress={fn()}>Carry on</NextStep>
      <NextStep signal onPress={fn()}>
        Resolve now
      </NextStep>
    </NextSteps>
  ),
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button')
    await expect(buttons.map((button) => button.textContent)).toEqual(['Carry on', 'Resolve now'])
    await expect(buttons[0]?.className).not.toMatch(/signal/)
    await expect(buttons[1]?.className).toMatch(/signal/)
  },
}

/** What needs the lead is words with an arrow, a link into the task: the card around it opens the task. */
export const Words: Story = {
  render: () => (
    <NextSteps>
      <NextStep>Ask the lead to fix it</NextStep>
    </NextSteps>
  ),
  play: async ({ canvasElement }) => {
    const step = within(canvasElement)
    await expect(step.getByText('Ask the lead to fix it')).toBeInTheDocument()
    await expect(step.queryByRole('button')).toBeNull()
  },
}

/** A step that goes somewhere, as a task's Open does: an arrow after its words. */
export const Opens: Story = {
  render: () => (
    <NextSteps>
      <NextStep signal arrow onPress={fn()}>
        Answer
      </NextStep>
    </NextSteps>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Answer' }).querySelector('svg')).not.toBeNull()
  },
}

/** Under way it says so, stays focusable and ignores presses. */
export const Busy: Story = {
  render: () => (
    <NextSteps>
      <NextStep signal busy onPress={fn()} label="Push 13 commits to #189" doing="Pushing 13 commits">
        Push 13 commits
      </NextStep>
    </NextSteps>
  ),
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Push 13 commits to #189' })
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toHaveTextContent('Pushing 13 commits')
  },
}
