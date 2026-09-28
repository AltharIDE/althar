import type { Meta, StoryObj } from '@storybook/react-vite'

import { fn } from 'storybook/test'

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
