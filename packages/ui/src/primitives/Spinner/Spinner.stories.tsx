import type { Meta, StoryObj } from '@storybook/react-vite'

import { Spinner } from './Spinner'
import { States } from '../../storybook/States'

/* `label` names the spinner for a screen reader when nothing beside it says what is running. It changes nothing on
   screen, so it has no story of its own. */
const meta = { title: 'Primitives/Spinner', component: Spinner, args: { size: 'medium' } } satisfies Meta<typeof Spinner>
export default meta
type Story = StoryObj<typeof meta>

export const Medium: Story = {}
export const Small: Story = { args: { size: 'small' } }
export const Large: Story = { args: { size: 'large' } }
export const OnFill: Story = {
  args: { tone: 'onFill' },
  render: (args) => (
    <span style={{ display: 'inline-flex', padding: 8, borderRadius: 7, background: 'var(--signal)' }}>
      <Spinner {...args} />
    </span>
  ),
}

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'small', node: <Spinner size="small" /> },
        { state: 'medium', node: <Spinner /> },
        { state: 'large', node: <Spinner size="large" /> },
        {
          state: 'on fill',
          node: (
            <span style={{ display: 'inline-flex', padding: 6, borderRadius: 7, background: 'var(--signal)' }}>
              <Spinner tone="onFill" />
            </span>
          ),
        },
        { state: 'on ink', dark: true, node: <Spinner tone="onFill" /> },
      ]}
    />
  ),
}
