import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ScratchShelf, type ScratchChat } from './ScratchShelf'

const CHATS: readonly ScratchChat[] = [
  {
    id: 'c1',
    title: 'How does the retry loop back off?',
    said: { by: 'lead', text: 'It doubles the wait each time, from 200ms, up to 5 tries, then gives up with the last error.' },
    at: '2m',
    running: true,
  },
  {
    id: 'c2',
    title: 'Which lane heights look right on a 13-inch screen?',
    said: { by: 'person', text: 'Try 52 and 64 side by side.' },
    at: '1h',
  },
  {
    id: 'c3',
    title: 'Why is the board slow to open?',
    said: { by: 'lead', text: 'The coordinator snapshot reads every card twice.' },
    at: 'yesterday',
  },
]

const meta = {
  title: 'Board/ScratchShelf',
  component: ScratchShelf,
  args: { chats: CHATS, onOpen: fn(), onClear: fn(), defaultOpen: true },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ScratchShelf>
export default meta
type Story = StoryObj<typeof meta>

/** Opened in place: the chats by their latest exchange, the latest first, a live dot on the one its lead is at. */
export const Opened: Story = {
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: /^Which lane heights/ }))
    await expect(args.onOpen).toHaveBeenCalledWith('c2')
  },
}

/** Clear settles a chat: it leaves Scratch, and ⌘K still finds it. */
export const Clears: Story = {
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Clear “Why is the board slow to open?”' }))
    await expect(args.onClear).toHaveBeenCalledWith('c3')
  },
}

/** Closed, it is one chip at the head of Up next. */
export const Chip: Story = { args: { defaultOpen: false } }
