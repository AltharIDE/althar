import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Artifacts } from './Artifacts'

/* A project's artifacts as one table: filtered by kind, searched and sorted; narrow; and none yet, wide and narrow. */

const meta = {
  title: 'Screens/Artifacts',
  component: Artifacts,
  parameters: { layout: 'fullscreen' },
  args: {
    onOpen: fn(),
    canvases: [
      {
        id: 'cnv_a',
        name: 'sign-in',
        title: 'Sign-in, three directions',
        kind: 'markdown',
        version: 3,
        by: 'Lead of Redesign sign-in',
        when: '4m ago',
        at: '2026-11-10T14:32:00.000Z',
        openComments: 1,
      },
      {
        id: 'cnv_b',
        name: 'sign-in-page',
        title: 'Sign-in page',
        kind: 'html',
        version: 2,
        by: 'Lead of Build sign-in',
        when: '46m ago',
        at: '2026-11-10T13:50:00.000Z',
        openComments: 0,
      },
      {
        id: 'cnv_c',
        name: 'architecture',
        title: 'How the runtime fits together',
        kind: 'mermaid',
        version: 5,
        by: 'Coordinator',
        when: '2h ago',
        at: '2026-11-10T12:20:00.000Z',
        openComments: 0,
      },
      {
        id: 'cnv_d',
        name: 'checkout-funnel',
        title: 'Checkout funnel',
        kind: 'svg',
        version: 1,
        by: 'Lead of Funnel report',
        when: '8 Nov',
        at: '2026-11-08T09:12:00.000Z',
        openComments: 2,
      },
      {
        id: 'cnv_e',
        name: 'empty-states',
        title: 'Empty states, before and after',
        kind: 'picture',
        version: 1,
        by: 'Lead of Redesign sign-in',
        when: 'Yesterday',
        at: '2026-11-09T16:44:00.000Z',
        openComments: 0,
      },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', background: 'var(--n-2)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Artifacts>
export default meta
type Story = StoryObj<typeof meta>

const names = (canvas: HTMLElement) =>
  within(canvas)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).queryAllByRole('button')[0]?.textContent ?? row.textContent)

/** Newest first; a row opens its artifact. */
export const Some: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(names(canvasElement)).toEqual([
      'Sign-in, three directions',
      'Sign-in page',
      'How the runtime fits together',
      'Empty states, before and after',
      'Checkout funnel',
    ])
    await userEvent.click(c.getByRole('button', { name: 'Sign-in page' }))
    await expect(args.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'cnv_b' }))
  },
}

/** A kind chosen, then words searched for, then sorted by name, and words that match nothing. */
export const Narrowed: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: 'Document' }))
    await expect(names(canvasElement)).toEqual(['Sign-in, three directions'])
    await expect(c.getByText('1 of 5')).toBeInTheDocument()
    await userEvent.click(c.getByRole('radio', { name: 'All' }))
    await userEvent.type(c.getByRole('searchbox', { name: 'Find an artifact' }), 'sign')
    await userEvent.click(c.getByRole('button', { name: 'Name' }))
    await expect(c.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending')
    await expect(names(canvasElement)).toEqual(['Empty states, before and after', 'Sign-in page', 'Sign-in, three directions'])
    await userEvent.clear(c.getByRole('searchbox', { name: 'Find an artifact' }))
    await userEvent.type(c.getByRole('searchbox', { name: 'Find an artifact' }), 'invoice')
    await expect(c.getByText('Nothing matches “invoice”.')).toBeInTheDocument()
  },
}

/** Sorted by open comments, most first. */
export const ByComments: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Comments' }))
    await expect(names(canvasElement)[0]).toBe('Checkout funnel')
  },
}

/** Narrow: what it is, its comments and when stay. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
}

/** One kind only: no filter to choose from. */
export const OneKind: Story = {
  args: {
    canvases: [
      {
        id: 'cnv_a',
        name: 'sign-in',
        title: 'Sign-in, three directions',
        kind: 'markdown',
        version: 3,
        by: 'Lead of Redesign sign-in',
        when: '4m ago',
        at: '2026-11-10T14:32:00.000Z',
        openComments: 1,
      },
    ],
  },
}

/** None yet: a wall of faint drawings where the table will be, and what will be here where it fades. */
export const None: Story = {
  args: { canvases: [] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('No artifacts yet')).toBeInTheDocument()
    await expect(c.queryByRole('table')).toBeNull()
  },
}

/** None yet, narrow: the wall is cut by the view's edges and still fades into them. */
export const NoneNarrow: Story = {
  args: { canvases: [] },
  decorators: Narrow.decorators,
}
