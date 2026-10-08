import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Light } from './Light'
import s from './Light.stories.module.css'

const meta = {
  title: 'Foundations/Light',
  component: Light,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className={s.stage}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Light>
export default meta
type Story = StoryObj<typeof meta>

/** It rises, the middle first, then drifts: each column on its own rhythm, the whole light swaying slowly. */
export const Drift: Story = {}

/** Standing, as with motion reduced. */
export const Still: Story = { args: { motion: 'still' } }

/** Lower, under more words. */
export const Low: Story = { args: { height: 0.3 } }

function Sinking() {
  const [sink, setSink] = useState(false)
  const [round, setRound] = useState(0)
  return (
    <>
      <div className={s.row}>
        <Button size="small" onClick={() => setSink(true)}>
          Sink
        </Button>
        <Button
          size="small"
          variant="quiet"
          onClick={() => {
            setSink(false)
            setRound((n) => n + 1)
          }}
        >
          Rise again
        </Button>
      </div>
      <Light key={round} sink={sink} />
    </>
  )
}

/** Told to sink, it lies down from the edges in, from wherever it stood, as when work starts on a home at rest. */
export const Sink: Story = { render: () => <Sinking /> }
