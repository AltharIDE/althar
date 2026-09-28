import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { Field } from './Field'

const meta = {
  title: 'Primitives/Field',
  component: Field,
  decorators: [(Story) => <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column' }}>{Story()}</div>],
  args: { 'aria-label': 'Repository URL', placeholder: 'github.com/owner/repository' },
} satisfies Meta<typeof Field>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A name you are giving something, set like a title. */
export const Large: Story = { args: { size: 'large', 'aria-label': 'Name', placeholder: 'Refunds v2' } }

export const Typing: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByRole('textbox'), 'github.com/meridian/infra')
    await expect(c.getByRole('textbox')).toHaveValue('github.com/meridian/infra')
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'input', focus: 'input', pressed: 'input' }),
  render: (args) => (
    <States
      cells={[
        { state: 'empty', node: <Field {...args} /> },
        { state: 'filled', node: <Field {...args} defaultValue="github.com/meridian/infra" /> },
        { state: 'hover', node: <Field {...args} /> },
        { state: 'focus', node: <Field {...args} /> },
        { state: 'disabled', node: <Field {...args} disabled defaultValue="github.com/meridian/infra" /> },
        { state: 'large', node: <Field {...args} size="large" defaultValue="Refunds v2" /> },
      ]}
    />
  ),
}
