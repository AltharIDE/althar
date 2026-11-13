import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'

import { States } from '../../storybook/States'
import { Field } from '../Field/Field'
import { Segmented } from '../Segmented/Segmented'
import { FormRow } from './FormRow'

const meta = {
  title: 'Primitives/FormRow',
  component: FormRow,
  args: {
    label: 'Name',
    note: 'The outcome or body of work. You can rename it later.',
    htmlFor: 'name',
    children: <Field id="name" defaultValue="Refunds v2" />,
  },
} satisfies Meta<typeof FormRow>
export default meta
type Story = StoryObj<typeof meta>

/** A panel's width: rows read their container to know when to stack. */
const panel = (width: number) => (Story: () => ReactNode) => <div style={{ maxWidth: width, containerType: 'inline-size' }}>{Story()}</div>

/** Without a note, the label stands alone. */
export const LabelOnly: Story = { decorators: [panel(720)], args: { note: undefined } }

/** A row of four longer choices, as a preset's Ends in Settings, with the project's setting chosen. */
export const FourChoices: Story = {
  decorators: [panel(720)],
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

/** At a panel's width the label sits beside its control; in a narrow one they stack. */
export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        {
          state: 'default',
          node: (
            <div style={{ containerType: 'inline-size' }}>
              <FormRow {...args} />
            </div>
          ),
        },
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
