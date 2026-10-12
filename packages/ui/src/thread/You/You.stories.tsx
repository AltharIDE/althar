import type { Meta, StoryObj } from '@storybook/react-vite'

import { expect, fn, userEvent, within } from 'storybook/test'

import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { AttachmentKind, Delivery } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { ThreadShellProvider } from '../Shell/Shell'
import { You } from './You'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/You',
  component: You,
  decorators: [threadDecorator],
  args: { at: '2h ago', children: 'Refunds should rate-limit like charges do. Match the headers exactly.' },
} satisfies Meta<typeof You>
export default meta
type Story = StoryObj<typeof meta>

export const Message: Story = {}
export const WithAttachments: Story = {
  args: {
    children: 'The spec and the response partners expect. The pasted bit is the current limiter config.',
    attach: [
      { id: 'spec', kind: AttachmentKind.File, name: 'rate-limits.md', meta: '4 KB' },
      {
        id: 'shot',
        kind: AttachmentKind.Image,
        name: '429-response.png',
        meta: '1280 × 720 · 84 KB',
        alt: 'A 429 response with a Retry-After header',
      },
      { id: 'paste', kind: AttachmentKind.Paste, name: 'Pasted text', meta: '38 lines' },
    ],
    onOpenAttachment: fn(),
  },
}
const IMAGES = [
  {
    id: 'before',
    kind: AttachmentKind.Image as const,
    name: 'refunds-before.png',
    src: SHOT_BEFORE.src,
    thumb: SHOT_BEFORE.src,
    meta: '1440 × 900',
  },
  {
    id: 'after',
    kind: AttachmentKind.Image as const,
    name: 'refunds-after.png',
    src: SHOT_AFTER.src,
    thumb: SHOT_AFTER.src,
    meta: '1440 × 900',
  },
]
const openImage = fn()

/** Images you sent with it, drawn from their smaller copies: each opens full size, with the message's others a key away. */
export const WithImages: Story = {
  decorators: [(Story) => <ThreadShellProvider value={{ openImage }}>{Story()}</ThreadShellProvider>],
  args: { children: 'The refund button moved between these two.', attach: IMAGES },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'View refunds-after.png' }))
    await expect(openImage).toHaveBeenCalledWith(IMAGES[1], IMAGES)
  },
}
/** Images sent with nothing written: no bubble of words under them. */
export const ImagesOnly: Story = {
  args: { children: '', attach: IMAGES.slice(0, 1) },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('p')).toBeNull()
  },
}
/** Without onOpenAttachment, files and pastes are shown but do not open. Images still open with the shell's openImage. */
export const AttachmentsThatDoNotOpen: Story = { args: { ...WithAttachments.args, onOpenAttachment: undefined } }
/** Sent while the lead works: the lead reads it next. */
export const Queued: Story = {
  args: { delivery: Delivery.Queued, at: undefined, children: 'Title the PR “Rate-limit refunds like charges”.' },
}
/** Sent now, while the lead works: until it has stopped at a safe point to read it. */
export const Interrupting: Story = {
  args: { delivery: Delivery.Interrupting, at: undefined, children: 'Stop, the limiter belongs in charges.' },
}
/** With no shell to open images in, and nothing to open files: every chip is still. */
export const NothingOpens: Story = {
  decorators: [(Story) => <ThreadShellProvider value={{}}>{Story()}</ThreadShellProvider>],
  args: { ...WithAttachments.args, onOpenAttachment: undefined },
}
export const Long: Story = {
  args: {
    children:
      'Two things before you start. Keep the limiter where it is, in charges, and import it rather than copying it. And add the test first, so we can see it fail on main before it passes on the branch.',
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-child', focus: 'button:first-child', pressed: 'button:first-child' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'message', node: <You {...args} /> },
        { state: 'queued', node: <You {...args} delivery={Delivery.Queued} at={undefined} /> },
        { state: 'interrupting', node: <You {...args} delivery={Delivery.Interrupting} at={undefined} /> },
        { state: 'attachments', node: <You {...args} {...WithAttachments.args} /> },
        { state: 'images', node: <You {...args} {...WithImages.args} /> },
        { state: 'images only', node: <You {...args} {...ImagesOnly.args} /> },
        { state: 'attachments, still', node: <You {...args} {...WithAttachments.args} onOpenAttachment={undefined} /> },
        { state: 'attachment, hover', force: 'hover', node: <You {...args} {...WithAttachments.args} /> },
        { state: 'attachment, focus', force: 'focus', node: <You {...args} {...WithAttachments.args} /> },
        {
          state: 'unfurled link',
          node: <You {...args} unfurl={<span style={{ fontSize: 12, color: 'var(--t-3)' }}>docs.stripe.com · Rate limits</span>} />,
        },
      ]}
    />
  ),
}
