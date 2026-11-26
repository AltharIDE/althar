import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { ROADMAP } from '../../fixtures/whatsNew'
import { ComingNext } from './ComingNext'

/* Coming next: the roadmap for the person to shape, what's being built largest; narrow; and dark. */

const meta = {
  title: 'Screens/ComingNext',
  component: ComingNext,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    items: ROADMAP,
    suggest: 'https://github.com/AltharIDE/althar/issues',
    talk: 'https://discord.gg/QA2g8MwKda',
  },
} satisfies Meta<typeof ComingNext>
export default meta
type Story = StoryObj<typeof meta>

/** Each thing with its picture and stage, and where to say what you'd need from it. */
export const Roadmap: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Being built')).toBeInTheDocument()
    await expect(page.getAllByRole('link', { name: /Say what you’d need/ })[0]).toHaveAttribute(
      'href',
      'https://github.com/AltharIDE/althar/issues/new?title=Mobile%20app%3A%20',
    )
  },
}

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 880, height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
}

export const Dark: Story = { globals: { theme: 'dark' } }
