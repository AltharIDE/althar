import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { expect, within } from 'storybook/test'

import { Icon } from '../../foundations/Icon/Icon'
import { VisuallyHidden } from './VisuallyHidden'

const meta = {
  title: 'Primitives/VisuallyHidden',
  component: VisuallyHidden,
  args: { children: 'added' },
  parameters: {
    docs: {
      description: {
        component:
          'Text that is not on screen but is read by a screen reader. It names what a sign or an icon means, where the sign is enough for the eye: a diff line’s “+” is read as “added”. It has no look of its own, so its story shows each line twice: as it shows, and as it is read.',
      },
    },
  },
} satisfies Meta<typeof VisuallyHidden>
export default meta
type Story = StoryObj<typeof meta>

/* A line as it shows, and under it the text a screen reader gets from it. */
function Heard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [read, setRead] = useState('')
  useLayoutEffect(() => setRead(ref.current?.textContent ?? ''), [children])
  return (
    <figure style={{ display: 'grid', gap: 6, margin: '0 0 18px' }}>
      <div ref={ref} style={{ fontSize: 12.5 }}>
        {children}
      </div>
      <figcaption style={{ font: '11px var(--mono)', color: 'var(--t-3)' }}>read as: “{read.trim()}”</figcaption>
    </figure>
  )
}

/** Nothing shows, but the text is read. */
export const AsShownAndAsRead: Story = {
  render: (args) => (
    <>
      <Heard>
        <code>
          +<VisuallyHidden {...args} /> retryAfter: &apos;seconds&apos;,
        </code>
      </Heard>
      <Heard>
        <code>
          −<VisuallyHidden>removed</VisuallyHidden> idempotent(createRefund))
        </code>
      </Heard>
      <Heard>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={12} />
          <VisuallyHidden>Queued:</VisuallyHidden> the lead reads it next
        </span>
      </Heard>
    </>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('added')).toBeInTheDocument()
  },
}
