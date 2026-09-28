import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { CheckList, type CheckItem } from './CheckList'

const ITEMS: CheckItem[] = [
  { id: 'prod', label: 'Deploys, and anything that reaches production' },
  { id: 'main', label: 'Pushing to main' },
  { id: 'people', label: 'Messages to people' },
]

function Example() {
  const [v, setV] = useState<readonly string[]>(['prod', 'main'])
  return <CheckList label="Always ask me" items={ITEMS} value={v} onChange={setV} />
}

const meta = {
  title: 'Primitives/CheckList',
  component: CheckList,
  args: { label: 'Always ask me', items: ITEMS, value: ['prod'], onChange: () => {} },
} satisfies Meta<typeof CheckList>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    /* the label is part of the target */
    await userEvent.click(c.getByText('Messages to people'))
    await expect(c.getByRole('checkbox', { name: 'Messages to people' })).toBeChecked()
    await userEvent.keyboard(' ')
    await expect(c.getByRole('checkbox', { name: 'Messages to people' })).not.toBeChecked()
  },
}

export const Disabled: Story = { args: { disabled: true } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'label:first-of-type', focus: 'label:first-of-type button', pressed: 'label:first-of-type' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'rest', node: <CheckList {...args} /> },
        { state: 'hover', node: <CheckList {...args} /> },
        { state: 'focus', node: <CheckList {...args} /> },
        { state: 'disabled', node: <CheckList {...args} disabled /> },
      ]}
    />
  ),
}
