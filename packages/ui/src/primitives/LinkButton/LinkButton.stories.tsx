import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { LinkButton } from './LinkButton'

const meta = { title: 'Primitives/LinkButton', component: LinkButton, args: { children: 'Undo', onClick: fn() } } satisfies Meta<
  typeof LinkButton
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Disabled: Story = { args: { disabled: true, children: 'Next status change' } }
/** Hidden until the row it sits in is hovered, or it takes focus with the keyboard. */
export const RevealOnHover: Story = {
  args: { reveal: true, children: 'Skip' },
  render: (args) => (
    <p style={{ display: 'flex', gap: 10, alignItems: 'center', margin: 0, padding: '6px 8px', fontSize: 13 }}>
      <span>Dry run on a copy</span>
      <LinkButton {...args} />
    </p>
  ),
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <States
      cells={['rest', 'hover', 'focus', 'pressed', 'disabled'].map((state) => ({
        state,
        node: <LinkButton disabled={state === 'disabled'}>Show all</LinkButton>,
      }))}
    />
  ),
}
