import type { Meta, StoryObj } from '@storybook/react-vite'

import { expect, within } from 'storybook/test'

import { Notice } from './Notice'

const meta = {
  title: 'Primitives/Notice',
  component: Notice,
  decorators: [(Story) => <div style={{ maxWidth: 560, padding: 24 }}>{Story()}</div>],
  args: {
    icon: 'flask',
    title: 'Homes are still experimental',
    children: 'Expect rough edges, and keep your work pushed while you try them.',
  },
} satisfies Meta<typeof Notice>
export default meta
type Story = StoryObj<typeof meta>

export const Shown: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('note')).toHaveTextContent('Homes are still experimental')
  },
}
/** A line alone, where it says all there is. */
export const LineAlone: Story = { args: { icon: 'phone', title: 'The phone app isn’t in the App Store yet.', children: undefined } }
