import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { PlansAndReviews, type PlansAndReviewsValue, plansAndReviewsDefault } from './PlansAndReviews'

/* The rows, their choices kept as Settings keeps them. */
function Rows({
  start = plansAndReviewsDefault,
  onChange,
}: {
  start?: PlansAndReviewsValue
  onChange?: (change: Partial<PlansAndReviewsValue>) => void
}) {
  const [value, setValue] = useState(start)
  return (
    <PlansAndReviews
      value={value}
      onChange={(change) => {
        onChange?.(change)
        setValue((was) => ({ ...was, ...change }))
      }}
    />
  )
}

const onChange = fn()

/* The open list is drawn over the page, outside the story. */
const page = within(document.body)

const meta = {
  title: 'Setup/PlansAndReviews',
  component: PlansAndReviews,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 680 }}>{Story()}</div>],
  args: { value: plansAndReviewsDefault, onChange },
} satisfies Meta<typeof PlansAndReviews>
export default meta
type Story = StoryObj<typeof meta>

/** Today's values: nothing offers a way back. */
export const Today: Story = {
  render: () => <Rows />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Start a plan after' })).toHaveTextContent('25 seconds')
    // No rounds to count: a fix is checked once at most.
    await expect(c.queryByRole('combobox', { name: 'Rounds of review' })).toBeNull()
    await expect(c.getByRole('combobox', { name: 'When a check finds more' })).toHaveTextContent('Carry on when every finding is settled')
    await expect(c.queryByRole('button', { name: /^Default: / })).toBeNull()
  },
}

/** A choice goes out at once, and its row offers today's value back. */
export const Changed: Story = {
  render: () => <Rows onChange={onChange} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('combobox', { name: 'Start a plan after' }))
    await userEvent.click(await page.findByRole('option', { name: '10 seconds' }))
    await expect(onChange).toHaveBeenLastCalledWith({ countdown: 10 })
    await userEvent.click(await c.findByRole('button', { name: 'Default: 25 seconds' }))
    await expect(onChange).toHaveBeenLastCalledWith({ countdown: 25 })
    await expect(c.getByRole('combobox', { name: 'Start a plan after' })).toHaveTextContent('25 seconds')
  },
}

/** The plan starts at once: no wait to hold it in. */
export const NoCountdown: Story = {
  render: () => <Rows start={{ ...plansAndReviewsDefault, countdown: 0 }} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Start a plan after' })).toHaveTextContent('Right away')
    await expect(c.getByText(/The plan starts as soon as it’s proposed\./)).toBeVisible()
  },
}

/** Asking instead of carrying on offers the way back to today's. */
export const AskMe: Story = {
  render: () => <Rows start={{ ...plansAndReviewsDefault, roundsOut: 'ask' }} onChange={onChange} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'When a check finds more' })).toHaveTextContent('Ask me')
    await userEvent.click(c.getByRole('button', { name: 'Default: Carry on when every finding is settled' }))
    await expect(onChange).toHaveBeenLastCalledWith({ roundsOut: 'settled' })
    await expect(c.getByRole('combobox', { name: 'When a check finds more' })).toHaveTextContent('Carry on when every finding is settled')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'today’s values', node: <PlansAndReviews value={plansAndReviewsDefault} onChange={fn()} /> },
        {
          state: 'shorter',
          node: <PlansAndReviews value={{ countdown: 10, rounds: 1, roundsOut: 'ask' }} onChange={fn()} />,
        },
        {
          state: 'longer',
          node: <PlansAndReviews value={{ countdown: 60, rounds: 5, roundsOut: 'settled' }} onChange={fn()} />,
        },
        { state: 'ask me', node: <PlansAndReviews value={{ ...plansAndReviewsDefault, roundsOut: 'ask' }} onChange={fn()} /> },
        { state: 'right away', node: <PlansAndReviews value={{ ...plansAndReviewsDefault, countdown: 0 }} onChange={fn()} /> },
      ]}
    />
  ),
}
