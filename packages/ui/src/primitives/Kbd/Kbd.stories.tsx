import type { Meta, StoryObj } from '@storybook/react-vite'

import { Kbd } from './Kbd'
import { States } from '../../storybook/States'

const meta = { title: 'Primitives/Kbd', component: Kbd, args: { children: '↵' } } satisfies Meta<typeof Kbd>
export default meta
type Story = StoryObj<typeof meta>

/** On a filled button it takes the button's words' colour: violet, then ink. */
const fill = (background: string, color: string, key: string) => (
  <span style={{ display: 'inline-flex', padding: 6, borderRadius: 7, background, color }}>
    <Kbd onFill>{key}</Kbd>
  </span>
)

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'key', node: <Kbd>↵</Kbd> },
        { state: 'word', node: <Kbd>esc</Kbd> },
        { state: 'chord', node: <Kbd>⌘P</Kbd> },
        { state: 'on fill', node: fill('var(--signal-fill)', 'var(--on-signal)', '↵') },
        { state: 'on ink', node: fill('var(--ink-fill)', 'var(--on-ink)', 'esc') },
      ]}
    />
  ),
}
