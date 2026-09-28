import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { Select, type SelectProps } from './Select'

const EFFORT = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Max', label: 'Max', disabled: true },
]

function Example(props: Partial<SelectProps<string>>) {
  const [value, setValue] = useState('High')
  return <Select label="Default effort" options={EFFORT} value={value} onChange={setValue} width={104} {...props} />
}

const meta = {
  title: 'Primitives/Select',
  component: Select,
  args: { label: 'Default effort', options: EFFORT, value: 'High', onChange: fn(), width: 104 },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 180 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select<string>>
export default meta
type Story = StoryObj<typeof meta>

export const Quiet: Story = {
  render: () => <Example />,
}

/** Choosing from the list. */
export const Choosing: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('combobox', { name: 'Default effort' }))
    await userEvent.click(await page.findByRole('option', { name: 'Low' }))
    /* the rest of the page stays hidden from assistive technology until the list has finished closing */
    await expect(await c.findByRole('combobox', { name: 'Default effort' })).toHaveTextContent('Low')
  },
}
export const Filled: Story = { render: () => <Example variant="filled" width={220} /> }
export const Open: Story = { render: () => <Example defaultOpen /> }

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      cells={[
        { state: 'rest', node: <Select {...args} /> },
        { state: 'hover', node: <Select {...args} /> },
        { state: 'focus', node: <Select {...args} /> },
        { state: 'pressed', node: <Select {...args} /> },
        { state: 'filled', node: <Select {...args} variant="filled" width={160} /> },
        { state: 'filled, hover', force: 'hover', node: <Select {...args} variant="filled" width={160} /> },
      ]}
    />
  ),
}
