import type { Meta, StoryObj } from '@storybook/react-vite'

import { HostAndWorkers } from './HostAndWorkers'

/* 0.10.0's lead drawn: this computer, a home on your own server and two workers, the work going between them. It loops while on screen. */

const meta = {
  title: 'Screens/WhatsNew/HostAndWorkers',
  component: HostAndWorkers,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof HostAndWorkers>
export default meta
type Story = StoryObj<typeof meta>

export const Playing: Story = {}

export const Dark: Story = { globals: { theme: 'dark' } }
