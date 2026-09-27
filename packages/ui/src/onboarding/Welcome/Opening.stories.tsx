import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Opening, type OpeningPoint } from './Opening'
import { welcomeText } from './Welcome'

/* Plays the opening again from the start. */
function Replayable({ children }: { children: ReactNode }) {
  const [n, setN] = useState(0)
  return (
    <div style={{ position: 'relative', height: '100vh', minHeight: 560 }}>
      <div key={n} style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        {children}
      </div>
      <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 5 }}>
        <Button variant="quiet" onClick={() => setN(n + 1)}>
          Replay
        </Button>
      </div>
    </div>
  )
}

/* The opening on paper, its crossing a little above the middle, as the welcome places it; with a name when it is one of several versions. */
function Stage({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <figure
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        margin: 0,
        overflow: 'hidden',
        background: 'var(--n-1)',
        boxShadow: '-1px 0 0 var(--line-2)',
      }}
    >
      <div style={{ position: 'absolute', left: '50%', top: 'calc(50% - 65px)' }}>{children}</div>
      {label && (
        <figcaption
          style={{
            position: 'absolute',
            top: 16,
            left: 18,
            zIndex: 4,
            font: '500 11px/1 var(--mono)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--t-2)',
          }}
        >
          {label}
        </figcaption>
      )}
    </figure>
  )
}

const meta = {
  title: 'Onboarding/Opening',
  component: Opening,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <Replayable>{Story()}</Replayable>],
  render: (args) => (
    <Stage>
      <Opening {...args} />
    </Stage>
  ),
  args: { name: welcomeText.name, line: welcomeText.line, point: 'dot' },
  argTypes: {
    point: { control: 'inline-radio', options: ['dot', 'ring', 'none'] satisfies OpeningPoint[] },
  },
} satisfies Meta<typeof Opening>
export default meta
type Story = StoryObj<typeof meta>

/** The opening as the welcome plays it: close on the mark as it is drawn, a strong pull back, and the name and line come into focus. Replay, or change the point. */
export const Default: Story = {}

/** The point, side by side: a plain dot set at the end, a plain circle drawn first and filled at the end, or none. */
export const Points: Story = {
  render: (args) => (
    <>
      {(['dot', 'ring', 'none'] as const).map((p) => (
        <Stage key={p} label={p}>
          <Opening {...args} point={p} />
        </Stage>
      ))}
    </>
  ),
}

/** Where it ends, with no motion: what reduced motion shows. */
export const Still: Story = { args: { still: true } }
