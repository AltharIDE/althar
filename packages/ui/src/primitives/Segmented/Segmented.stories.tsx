import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { Segmented, type SegmentedOption } from './Segmented'

type Effort = 'low' | 'medium' | 'high' | 'max'
const OPTIONS: SegmentedOption<Effort>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
]

function Example({ options = OPTIONS, initial = 'high' }: { options?: SegmentedOption<Effort>[]; initial?: Effort }) {
  const [v, setV] = useState<Effort>(initial)
  return (
    <div style={{ width: 280 }}>
      <Segmented label="Effort" options={options} value={v} onChange={setV} />
    </div>
  )
}

const meta = {
  title: 'Primitives/Segmented',
  component: Segmented,
  args: { label: 'Effort', options: OPTIONS, value: 'high', onChange: () => {} },
} satisfies Meta<typeof Segmented<Effort>>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Example />,
}

/** Tab in, arrows choose and wrap, End moves to the last. */
export const ChoosingByKeyboard: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.tab()
    await expect(c.getByRole('radio', { name: 'High' })).toHaveFocus()
    /* Radix moves focus on a timeout and chooses only while the arrow is held, as a person's key is: press, wait, release */
    const arrow = async () => {
      await userEvent.keyboard('{ArrowRight>}')
      await new Promise((r) => setTimeout(r, 30))
      await userEvent.keyboard('{/ArrowRight}')
    }
    await arrow()
    await waitFor(() => expect(c.getByRole('radio', { name: 'Max' })).toBeChecked())
    await arrow()
    await waitFor(() => expect(c.getByRole('radio', { name: 'Low' })).toBeChecked())
    await userEvent.keyboard('{End}')
    await waitFor(() => expect(c.getByRole('radio', { name: 'Max' })).toHaveFocus())
  },
}

/** An option the model does not offer is skipped by the arrows. */
export const WithDisabled: Story = {
  render: () => <Example options={OPTIONS.map((o) => (o.value === 'max' ? { ...o, disabled: true } : o))} />,
}

/* The state lands on one option, not on the group. */
export const AllStates: Story = {
  parameters: statesOn({ hover: '[role="radio"]:first-child', focus: '[aria-checked="true"]', pressed: '[role="radio"]:first-child' }),
  render: () => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({
          state,
          node: <Segmented label={`Effort, ${state}`} options={OPTIONS} value="high" onChange={() => {}} />,
        })),
        {
          state: 'disabled option',
          node: (
            <Segmented
              label="Effort, one disabled"
              options={OPTIONS.map((o) => ({ ...o, disabled: o.value === 'max' }))}
              value="high"
              onChange={() => {}}
            />
          ),
        },
        {
          state: 'dots and keys',
          node: (
            <Segmented
              label="Room, with dots"
              options={[
                { value: 'low', label: 'Talk', kbd: '⌘1', dot: 'new', dotLabel: 'new messages' },
                { value: 'medium', label: 'Board', kbd: '⌘2', dot: 'yours', dotLabel: 'waiting on you' },
                { value: 'high', label: 'Both', kbd: '⌘3' },
              ]}
              value="low"
              onChange={() => {}}
            />
          ),
        },
      ]}
    />
  ),
}
