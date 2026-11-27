import type { Meta, StoryObj } from '@storybook/react-vite'

import { YourWorkers } from './YourWorkers'

/* 0.10.0's lead drawn: this computer and two workers of yours, the work going between them. It loops while on screen. */

const meta = {
  title: 'Screens/WhatsNew/YourWorkers',
  component: YourWorkers,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof YourWorkers>
export default meta
type Story = StoryObj<typeof meta>

export const Playing: Story = {}

export const Dark: Story = { globals: { theme: 'dark' } }
