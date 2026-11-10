import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Artifacts } from './Artifacts'

/* A project's artifacts: its canvases as rows, every lead's and the coordinator's; and none yet. */

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
        openComments: 1,
      },
      {
        id: 'cnv_b',
        name: 'sign-in-page',
        title: 'Sign-in page',
        kind: 'html',
        version: 2,
        by: 'Lead of Build sign-in',
        when: '1h ago',
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
        openComments: 2,
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

export const Some: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Sign-in page/ }))
    await expect(args.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'cnv_b' }))
  },
}
/** Narrow: who made each goes; what it is and when stay. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 520 }}>
        <Story />
      </div>
    ),
  ],
}
export const None: Story = { args: { canvases: [] } }
