import type { Meta, StoryObj } from '@storybook/react-vite'

import { HalftoneMark } from './HalftoneMark'

const meta = {
  title: 'Foundations/HalftoneMark',
  component: HalftoneMark,
  args: { size: 136 },
} satisfies Meta<typeof HalftoneMark>
export default meta
type Story = StoryObj<typeof meta>

/** It comes up once, the base first, then the point. Reload the story to see it again. */
export const Rising: Story = {}

/** Drawn set, as with motion reduced. */
export const Set: Story = { args: { rise: false } }

/** Small, where it stands over a few words. */
export const Small: Story = { args: { size: 48 } }
