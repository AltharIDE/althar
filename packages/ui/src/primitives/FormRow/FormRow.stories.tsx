import type { Meta, StoryObj } from '@storybook/react-vite'

import { States } from '../../storybook/States'
import { Field } from '../Field/Field'
import { Segmented } from '../Segmented/Segmented'
import { FormRow } from './FormRow'

const meta = {
  title: 'Primitives/FormRow',
  component: FormRow,
  decorators: [(Story) => <div style={{ maxWidth: 720, containerType: 'inline-size' }}>{Story()}</div>],
  args: {
    label: 'Name',
    note: 'The outcome or body of work. You can rename it later.',
    htmlFor: 'name',
    children: <Field id="name" defaultValue="Refunds v2" />,
  },
} satisfies Meta<typeof FormRow>
export default meta
type Story = StoryObj<typeof meta>

/** The label names the field: clicking it puts you in the field. */
export const Default: Story = {}

/** Without a note, the label stands alone. */
export const LabelOnly: Story = { args: { note: undefined } }

/** A row of four longer choices, as a preset's Ends in Settings, with the project's setting chosen. */
export const FourChoices: Story = {
  args: {
    label: 'Ends',
    note: undefined,
    htmlFor: undefined,
    children: (
      <Segmented
        label="Ends"
        value="project"
        onChange={() => {}}
        options={[
          { value: 'project', label: 'As the project says' },
          { value: 'draft', label: 'Draft pull request' },
          { value: 'ready', label: 'Ready for review' },
          { value: 'none', label: 'Here' },
        ]}
      />
    ),
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'default', node: <FormRow {...args} /> },
        {
          state: 'narrow: stacks',
          node: (
            <div style={{ width: 420, containerType: 'inline-size' }}>
              <FormRow {...args} />
            </div>
          ),
        },
      ]}
    />
  ),
}
