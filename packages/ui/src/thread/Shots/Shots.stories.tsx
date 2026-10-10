import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Dash } from '../../fixtures/meridian'
import { SHOT_AFTER, SHOT_BEFORE, SHOT_BROKEN, SHOT_LOADING, SHOT_NOT_KEPT, SHOT_RUN } from '../../fixtures/shots'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { ThreadShellProvider } from '../Shell/Shell'
import { Shots } from './Shots'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Shots',
  component: Shots,
  decorators: [threadDecorator],
  args: {
    items: [
      { id: 'before', name: 'refund-refused-before.png', label: 'Before', meta: '1440 × 900', view: <Dash /> },
      { id: 'after', name: 'refund-refused-after.png', label: 'After', meta: '1440 × 900', view: <Dash after /> },
    ],
  },
} satisfies Meta<typeof Shots>
export default meta
type Story = StoryObj<typeof meta>

export const BeforeAndAfter: Story = {}
export const One: Story = {
  args: { items: [{ id: 'after', name: 'refund-refused-after.png', label: 'After', meta: '1440 × 900', view: <Dash after /> }] },
}

/** Pictures with a src: each shows its smaller copy, and opens full size with the others a key away. */
export const Pictures: Story = {
  args: { items: [SHOT_BEFORE, SHOT_AFTER] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'View After full size' }))
    const page = within(canvasElement.ownerDocument.body)
    const dialog = await page.findByRole('dialog', { name: 'After' })
    await expect(within(dialog).getByText('2 of 2')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(page.getByRole('dialog', { name: 'Before' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/** Still on their way: each box holds its shape, so nothing below moves when they come. */
export const Loading: Story = { args: { items: [SHOT_LOADING, { ...SHOT_LOADING, id: 'loading-2', name: 'cart.png' }] } }

/** One the host couldn't keep says why, and doesn't open; one whose file is gone says it couldn't be shown. */
export const Failed: Story = { args: { items: [SHOT_NOT_KEPT, SHOT_BROKEN] } }

/** A long run shows its first four; the rest wait behind Show all. */
export const Long: Story = {
  args: { items: SHOT_RUN },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('listitem')).toHaveLength(4)
    await userEvent.click(c.getByRole('button', { name: /Show all 9/ }))
    await expect(c.getAllByRole('listitem')).toHaveLength(9)
    await expect(c.getByRole('button', { name: /Show fewer/ })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(c.getByRole('button', { name: /Show fewer/ }))
    await expect(c.getAllByRole('listitem')).toHaveLength(4)
  },
}

/** Nothing to show: nothing is drawn. */
export const Empty: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('list')).not.toBeInTheDocument()
  },
}

/** Without a lightbox in the shell, the pictures are still. */
export const WithoutALightbox: Story = {
  args: { items: [SHOT_BEFORE, SHOT_AFTER] },
  render: (args) => (
    <ThreadShellProvider value={{}}>
      <Shots {...args} />
    </ThreadShellProvider>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'li:first-child button', focus: 'li:first-child button', pressed: 'li:first-child button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'before and after', node: <Shots {...args} /> },
        { state: 'one', node: <Shots items={args.items.slice(1)} /> },
        { state: 'pictures', node: <Shots items={[SHOT_BEFORE, SHOT_AFTER]} /> },
        { state: 'loading', node: <Shots items={[SHOT_LOADING, { ...SHOT_LOADING, id: 'loading-2', name: 'cart.png' }]} /> },
        { state: 'failed', node: <Shots items={[SHOT_NOT_KEPT, SHOT_BROKEN]} /> },
        { state: 'long', node: <Shots items={SHOT_RUN} /> },
        { state: 'empty', node: <Shots items={[]} /> },
        { state: 'hover', node: <Shots {...args} /> },
        { state: 'focus', node: <Shots {...args} /> },
        { state: 'pressed', node: <Shots {...args} /> },
      ]}
    />
  ),
}
