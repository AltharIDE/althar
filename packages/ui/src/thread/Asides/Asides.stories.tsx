import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { TaskFace } from '../TaskFace/TaskFace'
import { Thread } from '../Thread/Thread'
import { type Aside, AsideMoves, AsideTabs } from './Asides'

const ASIDES: readonly Aside[] = [
  { id: 'a1', title: 'Retry back-off', said: 'It backs off in the client and in the queue.', ago: '4m ago', running: true },
  {
    id: 'a2',
    title: 'Stripe API version',
    said: 'Done.',
    words: ['Done.', '2024-06-20, pinned in payments/client.ts.', 'Which Stripe API version do the webhook handlers expect?'],
    ago: '1h ago',
  },
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
    coordinatorWords: ['Opened a draft for the retry back-off.', 'Should the nightly reconcile run before the ledger export?'],
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

/** Anything said in a conversation finds it, not only its last line: a word from an earlier message, after a later reply. */
export const SearchingWhatWasSaid: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Coordinator/ }))
    const body = within(canvasElement.ownerDocument.body)
    const field = await body.findByRole('combobox', { name: 'Search conversations' })
    // The aside's last words are "Done."; the webhook was asked about before.
    await userEvent.type(field, 'webhook')
    // One has it in its name (those by name first), one in what was asked before; New aside at the foot.
    const found = body.getAllByRole('option')
    await expect(found).toHaveLength(3)
    await expect(found[0]).toHaveTextContent('Is the webhook signature checked twice?')
    const stripe = found[1]!
    await expect(stripe).toHaveTextContent('Stripe API version')
    await expect(stripe).toHaveTextContent('do the webhook handlers expect?')
    await userEvent.click(stripe)
    await expect(args.onPick).toHaveBeenCalledWith('a2')
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Coordinator/ }))
    // The coordinator's own conversation is found by what was said in it, too.
    await userEvent.type(await body.findByRole('combobox', { name: 'Search conversations' }), 'reconcile')
    const coordinator = body.getAllByRole('option')[0]!
    await expect(coordinator).toHaveTextContent('Coordinator')
    await expect(coordinator).toHaveTextContent('nightly reconcile')
    await userEvent.keyboard('{Enter}')
    await expect(args.onPick).toHaveBeenLastCalledWith(null)
  },
}

const MANY: readonly Aside[] = Array.from({ length: 14 }, (_, n) => ({
  id: `m${n}`,
  title: `Conversation number ${n + 1}`,
  ago: `${n + 1}h ago`,
}))

/** The search opens with the one open in sight, however far down the list it is. */
export const SearchingFarDown: Story = {
  args: { asides: MANY, older: [], current: 'm12' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Conversation number 13/ }))
    const body = within(canvasElement.ownerDocument.body)
    const field = await body.findByRole('combobox', { name: 'Search conversations' })
    const list = body.getByRole('listbox')
    const row = body.getAllByRole('option').find((one) => one.getAttribute('aria-selected') === 'true')!
    await expect(row).toHaveTextContent('Conversation number 13')
    await expect(field.getAttribute('aria-activedescendant')).toBe(row.id)
    const within_ = list.getBoundingClientRect()
    const at = row.getBoundingClientRect()
    await expect(at.top).toBeGreaterThanOrEqual(within_.top - 1)
    await expect(at.bottom).toBeLessThanOrEqual(within_.bottom + 1)
  },
}

/** The search as it opens: every conversation, the latest first, the one open marked, those a week old under their own heading. */
export const SearchOpen: Story = {
  args: { current: 'a6' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Why the merge queue/ }))
    await within(canvasElement.ownerDocument.body).findByRole('combobox', { name: 'Search conversations' })
  },
}

/** Words typed: those with them in their name first, then those with them in what was said, the passage that matched under. */
export const SearchResults: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /Coordinator/ }))
    const field = await within(canvasElement.ownerDocument.body).findByRole('combobox', { name: 'Search conversations' })
    await userEvent.type(field, 'webhook')
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

const WORDS = Array.from(
  { length: 14 },
  (_, n) => `Message ${n + 1}: the retry back-off waits twice as long after each failed call, up to a minute, then gives up.`,
)

/** The bar over a conversation: a column the height of the pane, the thread scrolling under it. */
function OverThread() {
  return (
    <div style={{ height: 420, display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <AsideTabs mark={<HalftoneMark size={15} rise={false} />} asides={ASIDES} older={OLDER} current={null} onPick={fn()} onNew={fn()} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <TaskFace under composer={<p style={{ margin: 0, padding: 12, color: 'var(--t-3)' }}>Message…</p>}>
          <Thread label="Conversation">
            {WORDS.map((words) => (
              <p key={words} style={{ margin: 0 }}>
                {words}
              </p>
            ))}
          </Thread>
        </TaskFace>
      </div>
    </div>
  )
}

/** At the top of the thread, nothing has scrolled under the bar: no shadow. */
export const OverTheThread: Story = { render: () => <OverThread /> }

/** Scrolled, the thread passes under the bar, which takes a light shadow along its lower edge. */
export const OverTheThreadScrolled: Story = {
  render: () => <OverThread />,
  play: async ({ canvasElement }) => {
    const scroller = canvasElement.querySelector<HTMLElement>('[class*="scroll"]:not([class*="scrollArea"])')
    if (scroller === null) throw new Error('no scroller')
    scroller.scrollTop = 200
    scroller.dispatchEvent(new Event('scroll'))
    await waitFor(() => expect(canvasElement.querySelector('[data-scrolled]')).not.toBeNull())
  },
}
