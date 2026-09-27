import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Dash } from '../../fixtures/meridian'
import { Lightbox } from './Lightbox'

const meta = {
  title: 'Thread/Lightbox',
  component: Lightbox,
  parameters: { layout: 'fullscreen' },
  args: { image: { name: 'refund-refused-after.png', meta: '1440 × 900 · 212 KB', view: <Dash after /> }, onClose: fn(), onOpen: fn() },
} satisfies Meta<typeof Lightbox>
export default meta
type Story = StoryObj<typeof meta>

export const Image: Story = {}
/** No preview to show: the name stands in. */
export const NoPreview: Story = { args: { image: { name: '429-response.png' } } }

/* A modal shows one at a time: with a preview and both actions, Close hovered. The rest are the stories above. */
export const AllStates: Story = {
  parameters: { pseudo: { hover: ['[role="dialog"] button:last-child'] } },
}
