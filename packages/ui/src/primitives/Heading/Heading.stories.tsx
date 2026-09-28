import type { Meta, StoryObj } from '@storybook/react-vite'

import { Heading } from './Heading'
import { States } from '../../storybook/States'

const meta = { title: 'Primitives/Heading', component: Heading, args: { level: 2, children: 'Checkout retries' } } satisfies Meta<
  typeof Heading
>
export default meta
type Story = StoryObj<typeof meta>

export const Level2: Story = {}
export const Level3: Story = { args: { level: 3 } }

/* The rank sets the outline, not the look: without a class every rank is plain text. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'h1', node: <Heading level={1}>Checkout retries</Heading> },
        { state: 'h2', node: <Heading level={2}>Checkout retries</Heading> },
        { state: 'h3', node: <Heading level={3}>Checkout retries</Heading> },
        { state: 'h6', node: <Heading level={6}>Checkout retries</Heading> },
      ]}
    />
  ),
}
