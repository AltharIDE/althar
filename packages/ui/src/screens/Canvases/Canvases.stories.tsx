import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Canvases } from './Canvases'

/* A project's canvases: every lead's and the coordinator's, and none yet. */

const meta = {
  title: 'Screens/Canvases',
  component: Canvases,
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
        by: 'The lead of Sign-in redesign · 4m ago',
        openComments: 1,
      },
      {
        id: 'cnv_b',
        name: 'sign-in-page',
        title: 'Sign-in page',
        kind: 'html',
        version: 2,
        by: 'The lead of Build sign-in · 1h ago',
        openComments: 0,
      },
      {
        id: 'cnv_c',
        name: 'architecture',
        title: 'How the runtime fits together',
        kind: 'mermaid',
        version: 5,
        by: 'The coordinator · 2h ago',
        openComments: 0,
      },
      {
        id: 'cnv_d',
        name: 'checkout-funnel',
        title: 'Checkout funnel',
        kind: 'svg',
        version: 1,
        by: 'The lead of Funnel report · 8 Nov',
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
} satisfies Meta<typeof Canvases>
export default meta
type Story = StoryObj<typeof meta>

export const Some: Story = {}
export const None: Story = { args: { canvases: [] } }
