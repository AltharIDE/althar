import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { type Aside, AsideMoves, AsideTabs } from './Asides'

const ASIDES: readonly Aside[] = [
  { id: 'a1', title: 'Retry back-off', said: 'It backs off in the client and in the queue.', ago: '4m ago', running: true },
  { id: 'a2', title: 'Stripe API version', said: '2024-06-20, pinned in payments/client.ts.', ago: '1h ago' },
  { id: 'a3', title: 'Refunds export name', said: 'Refund ledger reads best.', ago: '3h ago' },
  { id: 'a6', title: 'Why the merge queue reruns every check after a rebase onto main', said: 'It reruns them all.', ago: '5h ago' },
]
const OLDER: readonly Aside[] = [
  { id: 'a4', title: 'Is the webhook signature checked twice?', ago: '9 Nov' },
  { id: 'a5', title: 'What does the ledger table index on?', ago: '8 Nov' },
]

const meta = {
  title: 'Thread/Asides',
  component: AsideTabs,
  args: {
    mark: <HalftoneMark size={15} rise={false} />,
    asides: ASIDES,
    older: OLDER,
    current: null,
    onPick: fn(),
    onNew: fn(),
    onClear: fn(),
    onClearOlder: fn(),
    newKbd: '⌘⇧N',
    searchKbd: '⌘J',
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AsideTabs>
export default meta
type Story = StoryObj<typeof meta>

/** On the coordinator's conversation: its name as the heading, then the latest few asides as quiet words, one press each. */
export const OnTheCoordinator: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { name: /Coordinator/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(canvas.getByRole('tab', { name: 'Stripe API version' }))
    await expect(args.onPick).toHaveBeenCalledWith('a2')
  },
}

/** An aside open: its name the heading, the coordinator first among the others, and its ×. */
export const AsideOpen: Story = {
  args: { current: 'a1' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { name: 'Retry back-off' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(canvas.getByRole('tab', { name: /Coordinator/ }))
    await expect(args.onPick).toHaveBeenCalledWith(null)
  },
}

/** A long name keeps the heading, up to its share; the latest others give way first. */
export const LongName: Story = { args: { current: 'a6' } }

/** A new aside, just started: the heading says it is new, leaning, until its first words name it. */
export const Starting: Story = {
  args: { asides: [{ id: 'a0', title: '' }, ...ASIDES], current: 'a0' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('tab', { name: 'New aside' })).toHaveLength(1)
    await expect(canvas.getByRole('tab', { name: 'New aside' })).toHaveAttribute('aria-selected', 'true')
  },
}

/** The open aside's × clears it, as Delete does on its name. */
export const Clearing: Story = {
  args: { current: 'a2' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Clear Stripe API version' }))
    await expect(args.onClear).toHaveBeenCalledWith('a2')
    canvas.getByRole('tab', { name: 'Refunds export name' }).focus()
    await userEvent.keyboard('{Delete}')
    await expect(args.onClear).toHaveBeenCalledWith('a3')
  },
}

/** The heading opens a search over every conversation: by name, or by what was said last, the line it matched under. */
export const Searching: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Coordinator/ }))
    const body = within(canvasElement.ownerDocument.body)
    const field = await body.findByRole('combobox', { name: 'Search conversations' })
    await expect(field).toHaveFocus()
    await userEvent.type(field, 'payments')
    await expect(body.getAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('{Enter}')
    await expect(args.onPick).toHaveBeenCalledWith('a2')
  },
}

/** Those a week old are in the search, under their own heading, cleared together there. */
export const Older: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Coordinator/ }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Clear these 2' }))
    await expect(args.onClearOlder).toHaveBeenCalledWith(['a4', 'a5'])
  },
}

/** None yet: the coordinator, and +. */
export const None: Story = { args: { asides: [], older: [] } }

/** An open aside's moves, over its composer. */
export const Moves: StoryObj<typeof AsideMoves> = {
  render: () => (
    <div style={{ padding: 16, maxWidth: 520 }}>
      <AsideMoves onMakeTask={fn()} note="Asked 4m ago" />
    </div>
  ),
}
