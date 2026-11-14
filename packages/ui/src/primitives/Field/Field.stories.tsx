import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { Field, FieldArea, FieldError } from './Field'

const meta = {
  title: 'Primitives/Field',
  component: Field,
  args: { 'aria-label': 'Repository URL', placeholder: 'github.com/owner/repository' },
} satisfies Meta<typeof Field>
export default meta
type Story = StoryObj<typeof meta>

/** As wide as a field in a form. */
const column = (Story: () => ReactNode) => <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column' }}>{Story()}</div>

export const Default: Story = { decorators: [column] }

/** A name you are giving something, set like a title. */
export const Large: Story = { decorators: [column], args: { size: 'large', 'aria-label': 'Name', placeholder: 'Refunds v2' } }

export const Typing: Story = {
  decorators: [column],
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByRole('textbox'), 'github.com/meridian/infra')
    await expect(c.getByRole('textbox')).toHaveValue('github.com/meridian/infra')
  },
}

/** Several lines: a description. As tall as its rows, and pulled longer by hand. */
export const Area: Story = {
  decorators: [column],
  render: () => (
    <FieldArea
      aria-label="Description"
      placeholder="What it is about"
      defaultValue={'Refunds created before PR 1184\nhave no idempotency key.'}
    />
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'input', focus: 'input', pressed: 'input' }),
  render: (props) => {
    const args = { ...props, style: { flex: 1 } }
    return (
      <States
        size="wide"
        cells={[
          { state: 'empty', node: <Field {...args} /> },
          { state: 'filled', node: <Field {...args} defaultValue="github.com/meridian/infra" /> },
          { state: 'hover', node: <Field {...args} /> },
          { state: 'focus', node: <Field {...args} /> },
          { state: 'disabled', node: <Field {...args} disabled defaultValue="github.com/meridian/infra" /> },
          { state: 'large', node: <Field {...args} size="large" defaultValue="Refunds v2" /> },
          {
            state: 'several lines',
            node: <FieldArea aria-label="Description" rows={3} defaultValue="Refunds created before PR 1184" style={args.style} />,
          },
          {
            state: 'invalid',
            node: (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <Field {...props} invalid defaultValue="meridian/infra" aria-describedby="field-invalid-why" />
                <FieldError id="field-invalid-why">Paste the whole address, starting with https://.</FieldError>
              </div>
            ),
          },
          {
            state: 'several lines, invalid',
            node: (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <FieldArea aria-label="Description" rows={3} invalid aria-describedby="field-area-invalid-why" />
                <FieldError id="field-area-invalid-why">Say what the issue is about.</FieldError>
              </div>
            ),
          },
        ]}
      />
    )
  },
}
