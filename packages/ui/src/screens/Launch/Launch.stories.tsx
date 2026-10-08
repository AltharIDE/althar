import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Launch } from './Launch'

/* What the launch opens onto here: a page of the window, standing in for the app, whose cards arrive one by one. */
const CARDS = ['Ready to accept', 'Running', 'Running', 'Since you looked']

function Behind() {
  return (
    <div style={{ height: '100%', padding: '72px 0', background: 'var(--n-2)' }}>
      <div data-arrive-each style={{ display: 'grid', gap: 10, width: 'min(560px, 90%)', margin: '0 auto' }}>
        {CARDS.map((card, i) => (
          <div
            key={i}
            style={{
              padding: '16px 18px',
              borderRadius: 'var(--r)',
              background: 'var(--n-1)',
              boxShadow: 'var(--lift-card)',
              font: '500 13px/1.5 var(--font)',
              color: 'var(--t-2)',
            }}
          >
            {card}
          </div>
        ))}
      </div>
    </div>
  )
}

/* One launch, whose behind is ready after `after` milliseconds. */
function Once({ after, quick }: { after: number; quick: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), after)
    return () => clearTimeout(timer)
  }, [after])
  return (
    <Launch ready={ready} quick={quick}>
      <Behind />
    </Launch>
  )
}

/* Plays the launch again from the start; what is behind is ready after `after` milliseconds. */
function Replayable({ after, quick = false }: { after: number; quick?: boolean }) {
  const [n, setN] = useState(0)
  return (
    <div style={{ position: 'relative', height: '100vh', minHeight: 560 }}>
      <Once key={n} after={after} quick={quick} />
      <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 100 }}>
        <Button variant="quiet" onClick={() => setN(n + 1)}>
          Replay
        </Button>
      </div>
    </div>
  )
}

const meta = {
  title: 'Screens/Launch',
  component: Launch,
  parameters: { layout: 'fullscreen' },
  args: { ready: true },
} satisfies Meta<typeof Launch>

export default meta
type Story = StoryObj<typeof meta>

/** As at a launch: what is behind is ready before the mark is up. */
export const Opening: Story = { render: () => <Replayable after={600} /> }

/** What is behind takes longer than the mark: the light stands and the mark holds until it is ready. */
export const Waiting: Story = { render: () => <Replayable after={3600} /> }

/** After a reload, or with motion reduced: the mark set, then a fade. */
export const Quick: Story = { render: () => <Replayable after={400} quick /> }
