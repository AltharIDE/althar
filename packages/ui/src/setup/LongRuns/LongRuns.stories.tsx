import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { LongRuns, type LongRunsValue, longRunsDefault } from './LongRuns'

/* The four rows, their choices kept as Settings keeps them. */
function Rows({ start = longRunsDefault, onChange }: { start?: LongRunsValue; onChange?: (change: Partial<LongRunsValue>) => void }) {
  const [value, setValue] = useState(start)
  return (
    <LongRuns
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
  title: 'Setup/LongRuns',
  component: LongRuns,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 680 }}>{Story()}</div>],
  args: { value: longRunsDefault, onChange },
} satisfies Meta<typeof LongRuns>
export default meta
type Story = StoryObj<typeof meta>

/** Today's values: nothing offers a way back. */
export const Today: Story = {
  render: () => <Rows />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Start a plan after' })).toHaveTextContent('25 seconds')
    await expect(c.getByRole('combobox', { name: 'Rounds of review' })).toHaveTextContent('3 rounds')
    await expect(c.getByRole('combobox', { name: 'Restart a quiet turn after' })).toHaveTextContent('10 minutes')
    await expect(c.getByRole('combobox', { name: 'Check in after' })).toHaveTextContent('6 hours')
    await expect(c.queryByRole('button', { name: /^Use / })).toBeNull()
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
    await userEvent.click(await c.findByRole('button', { name: 'Use 25 seconds' }))
    await expect(onChange).toHaveBeenLastCalledWith({ countdown: 25 })
    await expect(c.getByRole('combobox', { name: 'Start a plan after' })).toHaveTextContent('25 seconds')
  },
}

/** The plan starts at once: no wait to hold it in. */
export const NoCountdown: Story = {
  render: () => <Rows start={{ ...longRunsDefault, countdown: 0 }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('combobox', { name: 'Start a plan after' })).toHaveTextContent('Right away')
  },
}

/** Never checking in: the line says agents go on, and the turns' limit goes with the hours. */
export const NeverChecksIn: Story = {
  render: () => <Rows start={{ ...longRunsDefault, checkIn: 0 }} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Check in after' })).toHaveTextContent('Never')
    await expect(c.getByText(/Agents go on until you stop them\./)).toBeVisible()
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'today’s values', node: <LongRuns value={longRunsDefault} onChange={fn()} /> },
        {
          state: 'shorter everywhere',
          node: <LongRuns value={{ countdown: 10, rounds: 1, quiet: 5, checkIn: 2 }} onChange={fn()} />,
        },
        {
          state: 'longer everywhere',
          node: <LongRuns value={{ countdown: 60, rounds: 5, quiet: 20, checkIn: 12 }} onChange={fn()} />,
        },
        {
          state: 'right away, never checks in',
          node: <LongRuns value={{ ...longRunsDefault, countdown: 0, checkIn: 0 }} onChange={fn()} />,
        },
      ]}
    />
  ),
}
