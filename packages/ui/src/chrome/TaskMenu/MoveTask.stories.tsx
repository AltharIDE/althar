import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import { ModelPick } from '../../composer/ModelPick/ModelPick'
import { SONNET, model } from '../../fixtures/models'
import { MoveTaskDialog } from './MoveTask'

/** Moving to a worker that doesn't offer the lead's model: the picker holds only what the worker's agent offers there. */
function Moving({ picked }: { picked?: boolean }) {
  const [id, setId] = useState<string | null>(picked === true ? SONNET.id : null)
  // What the worker's Claude Code offers there.
  const offered = [SONNET]
  return (
    <MoveTaskDialog
      place="runner-1"
      model="Claude Opus 5"
      canMove={id !== null}
      onMove={fn()}
      onClose={fn()}
      picker={
        <ModelPick
          model={id === null ? { ...SONNET, name: 'Pick a model' } : (model(id) ?? SONNET)}
          pinned={offered}
          effort={null}
          defaultEffort={null}
          owner="Lead"
          count={offered.length}
          onChange={setId}
          onEffort={fn()}
          onBrowse={fn()}
          variant="field"
          placement="below"
        />
      }
    />
  )
}

const meta = {
  title: 'Chrome/TaskMenu/Move',
  component: Moving,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Moving>
export default meta
type Story = StoryObj<typeof meta>

/** Its lead's model isn't offered there: it says so, and Move waits for one that is. */
export const ModelNotThere: Story = {}

/** A model the worker offers, picked: Move moves it. */
export const ModelPicked: Story = { args: { picked: true } }

export const ModelNotThereDark: Story = { globals: { theme: 'dark' } }
