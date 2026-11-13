import type { Meta, StoryObj } from '@storybook/react-vite'

import { Spinner } from './Spinner'
import { States } from '../../storybook/States'

/* `label` names the spinner for a screen reader when nothing beside it says what is running. It changes nothing on
   screen, so it has no story of its own. */
const meta = { title: 'Primitives/Spinner', component: Spinner, args: { size: 'medium' } } satisfies Meta<typeof Spinner>
export default meta
type Story = StoryObj<typeof meta>

/** On a filled button it takes the button's words' colour: violet, then ink. */
const fill = (background: string, color: string) => (
  <span style={{ display: 'inline-flex', padding: 6, borderRadius: 7, background, color }}>
    <Spinner tone="onFill" />
  </span>
)

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'small', node: <Spinner size="small" /> },
        { state: 'medium', node: <Spinner /> },
        { state: 'large', node: <Spinner size="large" /> },
        { state: 'on fill', node: fill('var(--signal-fill)', 'var(--on-signal)') },
        { state: 'on ink', node: fill('var(--ink-fill)', 'var(--on-ink)') },
      ]}
    />
  ),
}
