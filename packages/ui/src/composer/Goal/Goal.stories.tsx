import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Composer } from '../Composer/Composer'
import { Goal } from './Goal'

const meta = {
  title: 'Composer/Goal',
  component: Goal,
  args: {
    goal: {
      objective: 'Get checkout tests passing in every supported browser.',
      status: 'active',
      rounds: 2,
      roundLimit: 12,
      progress: 'Checkout tests pass in Chromium.',
      detail: null,
      waiting: false,
    },
    objectiveLimit: 4000,
    expanded: false,
    onExpand: fn(),
    onPause: fn(),
    onResume: fn(),
    onEdit: fn(),
    onClear: fn(),
  },
  render: function GoalInComposer(args) {
    const [expanded, setExpanded] = useState(args.expanded)
    return (
      <div style={{ width: 'min(560px, 100%)', paddingBlockStart: 190 }}>
        <Composer
          value=""
          placeholder="Tell the lead"
          onChange={fn()}
          onSubmit={fn()}
          above={<Goal {...args} expanded={expanded} onExpand={setExpanded} />}
        />
      </div>
    )
  },
} satisfies Meta<typeof Goal>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {}

export const Blocked: Story = {
  args: {
    expanded: true,
    goal: {
      ...meta.args.goal,
      objective: 'Verify that the migration works against the production schema.',
      status: 'blocked',
      detail: 'The staging database is unavailable. The local migration tests passed.',
    },
  },
}

export const Complete: Story = {
  args: {
    expanded: true,
    goal: {
      ...meta.args.goal,
      status: 'complete',
      detail: 'All 42 checkout cases passed in Chromium, Firefox, and WebKit.',
    },
  },
}
