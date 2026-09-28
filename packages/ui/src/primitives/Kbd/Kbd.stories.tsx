import type { Meta, StoryObj } from '@storybook/react-vite'

import { Kbd } from './Kbd'
import { States } from '../../storybook/States'

const meta = { title: 'Primitives/Kbd', component: Kbd, args: { children: '↵' } } satisfies Meta<typeof Kbd>
export default meta
type Story = StoryObj<typeof meta>

export const Key: Story = {}
export const Word: Story = { args: { children: 'esc' } }
export const Chord: Story = { args: { children: '⌘P' } }
export const OnFill: Story = {
  args: { onFill: true },
  render: (args) => (
    <span style={{ display: 'inline-flex', padding: 8, borderRadius: 7, background: 'var(--signal)' }}>
      <Kbd {...args} />
    </span>
  ),
}

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'key', node: <Kbd>↵</Kbd> },
        { state: 'word', node: <Kbd>esc</Kbd> },
        { state: 'chord', node: <Kbd>⌘P</Kbd> },
        {
          state: 'on fill',
          node: (
            <span style={{ display: 'inline-flex', padding: 6, borderRadius: 7, background: 'var(--signal)' }}>
              <Kbd onFill>↵</Kbd>
            </span>
          ),
        },
        { state: 'on ink', dark: true, node: <Kbd onFill>esc</Kbd> },
      ]}
    />
  ),
}
