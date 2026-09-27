import type { Meta, StoryObj } from '@storybook/react-vite'

import { States } from '../../storybook/States'
import { Button } from '../Button/Button'
import { Field } from '../Field/Field'
import { FormRow } from '../FormRow/FormRow'
import { Panel } from './Panel'

const meta = {
  title: 'Primitives/Panel',
  component: Panel,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 720 }}>{Story()}</div>],
  args: {
    kicker: 'Meridian · settings',
    title: 'This project',
    lede: 'For every task in it.',
    foot: 'Changes apply to tasks started after them.',
    children: (
      <FormRow label="Name" note="You can rename it any time." htmlFor="panel-name">
        <Field id="panel-name" defaultValue="Meridian" />
      </FormRow>
    ),
  },
} satisfies Meta<typeof Panel>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** As a form, with the buttons that submit it in the foot. */
export const AsAForm: Story = {
  render: (args) => (
    <Panel
      as="form"
      kicker={args.kicker}
      title={args.title}
      onSubmit={(e) => e.preventDefault()}
      foot={
        <>
          <span style={{ flex: 1 }}>{args.foot}</span>
          <Button variant="quiet">Cancel</Button>
          <Button type="submit">Save</Button>
        </>
      }
    >
      {args.children}
    </Panel>
  ),
}

/** Just a title and its rows. */
export const Bare: Story = { args: { kicker: undefined, lede: undefined, foot: undefined } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'default', node: <Panel {...args} /> },
        { state: 'bare', node: <Panel {...args} kicker={undefined} lede={undefined} foot={undefined} /> },
      ]}
    />
  ),
}
