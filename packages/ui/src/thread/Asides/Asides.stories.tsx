import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { type Aside, AsideMoves, AsideTabs } from './Asides'

const ASIDES: readonly Aside[] = [
  { id: 'a1', title: 'Why does the retry back off twice?', said: 'It backs off in the client and in the queue.', running: true },
  { id: 'a2', title: 'Which Stripe API version are we on?', said: '2024-06-20, pinned in payments/client.ts.' },
  { id: 'a3', title: 'Name for the refunds export', said: 'Refund ledger reads best.' },
]
const OLDER: readonly Aside[] = [
  { id: 'a4', title: 'Is the webhook signature checked twice?' },
  { id: 'a5', title: 'What does the ledger table index on?' },
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
    onClearOlder: fn(),
    newKbd: '⌘⇧N',
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AsideTabs>
export default meta
type Story = StoryObj<typeof meta>

/** On the coordinator's conversation: the coordinator first, with its mark, then the asides, the latest first. */
export const OnTheCoordinator: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { name: /Coordinator/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(canvas.getByRole('tab', { name: /Stripe API/ }))
    await expect(args.onPick).toHaveBeenCalledWith('a2')
  },
}

/** An aside open. */
export const AsideOpen: Story = { args: { current: 'a1' } }

/** A new aside, just started: its one pill, open and first, says it is new until its first words name it. */
export const Starting: Story = {
  args: { asides: [{ id: 'a0', title: '' }, ...ASIDES], current: 'a0' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('tab', { name: 'New aside' })).toHaveLength(1)
    await expect(canvas.getByRole('tab', { name: 'New aside' })).toHaveAttribute('aria-selected', 'true')
  },
}

/** Those a week old fold into one pill, which clears them together. */
export const Older: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '2 older' }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('menuitem', { name: 'Clear these 2' }))
    await expect(args.onClearOlder).toHaveBeenCalledWith(['a4', 'a5'])
  },
}

/** None yet: the coordinator, and +. */
export const None: Story = { args: { asides: [], older: [] } }

/** An open aside's moves, over its composer. */
export const Moves: StoryObj<typeof AsideMoves> = {
  render: () => (
    <div style={{ padding: 16, maxWidth: 520 }}>
      <AsideMoves onMakeTask={fn()} onClear={fn()} note="Asked 4m ago" />
    </div>
  ),
}
