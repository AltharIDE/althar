import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { Choices, type ChoiceOption } from './Choices'

type Limit = 'move' | 'wait' | 'ask'
const OPTIONS: ChoiceOption<Limit>[] = [
  { value: 'move', title: 'Move the work to the next agent free', note: 'In the order of your connections.' },
  { value: 'wait', title: 'Wait for the reset', note: 'The task keeps its place and resumes on its own.' },
  { value: 'ask', title: 'Ask me' },
]

function Example({ options = OPTIONS }: { options?: ChoiceOption<Limit>[] }) {
  const [v, setV] = useState<Limit>('move')
  return (
    <div style={{ width: 420 }}>
      <Choices label="Usage limits" options={options} value={v} onChange={setV} />
    </div>
  )
}

const meta = {
  title: 'Primitives/Choices',
  component: Choices,
  args: { label: 'Usage limits', options: OPTIONS, value: 'move', onChange: () => {} },
} satisfies Meta<typeof Choices<Limit>>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Example />,
}

/** Choosing by pointer, then by arrow key. */
export const Choosing: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Wait for the reset/ }))
    await expect(c.getByRole('radio', { name: /Wait for the reset/ })).toBeChecked()
    await userEvent.keyboard('{ArrowDown>}')
    await new Promise((r) => setTimeout(r, 30))
    await userEvent.keyboard('{/ArrowDown}')
    await waitFor(() => expect(c.getByRole('radio', { name: 'Ask me' })).toBeChecked())
  },
}

export const WithDisabled: Story = { render: () => <Example options={OPTIONS.map((o) => ({ ...o, disabled: o.value === 'ask' }))} /> }

export const AllStates: Story = {
  parameters: statesOn({ hover: '[role="radio"]:nth-child(2)', focus: '[aria-checked="true"]', pressed: '[role="radio"]:nth-child(2)' }),
  render: () => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({
          state,
          node: <Choices label={`Limits, ${state}`} options={OPTIONS} value="move" onChange={() => {}} />,
        })),
        {
          state: 'disabled option',
          node: (
            <Choices
              label="Limits, one disabled"
              options={OPTIONS.map((o) => ({ ...o, disabled: o.value === 'ask' }))}
              value="move"
              onChange={() => {}}
            />
          ),
        },
      ]}
    />
  ),
}
