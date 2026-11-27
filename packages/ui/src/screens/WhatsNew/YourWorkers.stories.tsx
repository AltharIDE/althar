import type { Meta, StoryObj } from '@storybook/react-vite'

import { YourWorkers } from './YourWorkers'

/* 0.10.0's lead drawn: one worker of yours, then a fleet round this computer. It loops while on screen; given `at`, it holds where the host puts it. */

const meta = {
  title: 'Screens/WhatsNew/YourWorkers',
  component: YourWorkers,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof YourWorkers>
export default meta
type Story = StoryObj<typeof meta>

export const Playing: Story = {}

export const Dark: Story = { globals: { theme: 'dark' } }

/** Close up: runner-1 has run the task's setup and tests. */
export const OneWorker: Story = { args: { at: 0.32 } }

/** The view pulling back, the rings drawing in. */
export const PullingBack: Story = { args: { at: 0.6 } }

/** The fleet, whole. */
export const Fleet: Story = { args: { at: 1 } }

export const FleetDark: Story = { args: { at: 1 }, globals: { theme: 'dark' } }
