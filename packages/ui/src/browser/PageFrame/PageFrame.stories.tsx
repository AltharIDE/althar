import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PAGE, PHONE_PAGE } from '../../fixtures/pages'
import { CommentBox, PageFrame } from './PageFrame'

const meta = {
  title: 'Browser/PageFrame',
  component: PageFrame,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', width: 640, height: 700 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageFrame>
export default meta
type Story = StoryObj<typeof meta>

/** The page at the panel's own size, as a picture in its place. */
export const Fit: Story = { args: { still: PAGE } }

/** At a phone's size: drawn whole in a well, smaller where the panel is shorter. */
export const Device: Story = { args: { page: { x: 145, y: 16, width: 350, height: 668 }, still: PHONE_PAGE } }
export const DeviceDark: Story = { ...Device, globals: { theme: 'dark' } }

const banner = { x: 24, y: 124, width: 592, height: 56 }

/** A comment written on an element: outlined on the page's picture, the box under it. Enter adds it. */
export const Commenting: Story = {
  args: {
    still: PAGE,
    children: (
      <CommentBox
        at={banner}
        room={{ width: 640, height: 700 }}
        n={1}
        element="div.banner"
        size="592 × 56"
        onSubmit={fn()}
        onCancel={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Comment on div.banner' })
    await expect(field).toHaveFocus()
    await expect(c.getByRole('button', { name: 'Comment' })).toBeDisabled()
    await userEvent.type(field, 'Say what happened')
    await expect(c.getByRole('button', { name: 'Comment' })).toBeEnabled()
  },
}
export const CommentingDark: Story = { ...Commenting, globals: { theme: 'dark' } }

/** A comment opened again from its chip: Save and Remove. */
export const CommentAgain: Story = {
  args: {
    still: PAGE,
    children: (
      <CommentBox
        at={banner}
        room={{ width: 640, height: 700 }}
        n={1}
        element="div.banner"
        size="592 × 56"
        defaultValue="Say what happened: too many refunds at once."
        existing
        onSubmit={fn()}
        onCancel={fn()}
        onRemove={fn()}
      />
    ),
  },
}

/** An element at the page's foot: the box goes over it. */
export const AtTheFoot: Story = {
  args: {
    still: PAGE,
    children: (
      <CommentBox
        at={{ x: 24, y: 584, width: 592, height: 52 }}
        room={{ width: 640, height: 700 }}
        n={3}
        element="li.refund"
        size="592 × 52"
        onSubmit={fn()}
        onCancel={fn()}
      />
    ),
  },
}
