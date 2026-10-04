import type { Meta, StoryObj } from '@storybook/react-vite'

import { States } from '../../storybook/States'
import { Logo } from './Logo'
import s from './Logo.stories.module.css'

const meta = {
  title: 'Foundations/Logo',
  component: Logo,
  args: { size: 48 },
} satisfies Meta<typeof Logo>
export default meta
type Story = StoryObj<typeof meta>

export const Mark: Story = {}

/** The sizes it is drawn at: 16 in a tab and beside a name, up to 64 for a tile. */
export const Sizes: Story = {
  render: () => (
    <span className={s.sizes}>
      <Logo size={12} />
      <Logo size={16} />
      <Logo size={24} />
      <Logo size={32} />
      <Logo size={64} />
    </span>
  ),
}

/** In the ink around it: on paper, on ink, and on a cobalt tile (the favicon), where the point is the tile showing through. */
export const Grounds: Story = {
  render: () => (
    <States
      cells={[
        { state: 'paper', node: <Logo size={32} /> },
        { state: 'ink', node: <Logo size={32} className={s.onInk} />, dark: true },
        {
          state: 'cobalt tile',
          node: (
            <span className={s.tile}>
              <Logo size={44} />
            </span>
          ),
        },
      ]}
    />
  ),
}

/** Beside the name, in the product's type. */
export const Lockup: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        {
          state: 'chrome',
          node: (
            <span className={s.lockup}>
              <Logo size={18} />
              Althar
            </span>
          ),
        },
        {
          state: 'large',
          node: (
            <span className={`${s.lockup} ${s.lockupLarge}`}>
              <Logo size={40} />
              Althar
            </span>
          ),
        },
      ]}
    />
  ),
}
