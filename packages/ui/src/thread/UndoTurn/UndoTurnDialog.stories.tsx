import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import { Composer } from '../../composer/Composer/Composer'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from '../Markdown/Markdown'
import { Thread } from '../Thread/Thread'
import { Turn } from '../Turn/Turn'
import { You } from '../You/You'
import { UndoTurnDialog } from './UndoTurnDialog'

const PROMPT = 'Raise the retry limit to twenty and remove the backoff.'

function Conversation({
  asking = false,
  restored = false,
  busy = false,
  error = null,
}: {
  asking?: boolean
  restored?: boolean
  busy?: boolean
  error?: string | null
}) {
  const [open, setOpen] = useState(asking)
  const [undone, setUndone] = useState(restored)
  const [draft, setDraft] = useState(restored ? PROMPT : '')
  return (
    <>
      <Thread label="Retry checkout">
        <You at="4m ago">Keep retries bounded and keep the exponential backoff.</You>
        <Turn voice="Lead" at="3m ago">
          <Markdown source="Retries are bounded at three attempts, with exponential backoff between attempts." />
        </Turn>
        {!undone && (
          <>
            <You at="1m ago" onUndo={() => setOpen(true)}>
              {PROMPT}
            </You>
            <Turn voice="Lead" at="Just now">
              <Markdown source="The retry limit is now twenty. I removed the backoff and updated the tests in `retry.test.ts`." />
            </Turn>
          </>
        )}
      </Thread>
      <div style={{ paddingTop: 48 }}>
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={fn()}
          placeholder="Reply to the lead…"
          notice={undone ? <span role="status">Files and conversation restored.</span> : undefined}
        />
      </div>
      {open && (
        <UndoTurnDialog
          prompt={PROMPT}
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          onUndo={() => {
            setUndone(true)
            setDraft(PROMPT)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

const meta = {
  title: 'Thread/UndoTurn',
  component: Conversation,
  decorators: [threadDecorator],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Conversation>
export default meta
type Story = StoryObj<typeof meta>

export const Available: Story = {}
export const Confirm: Story = { args: { asking: true } }
export const Restoring: Story = { args: { asking: true, busy: true } }
export const LaterEdit: Story = {
  args: { asking: true, error: 'retry.ts changed after this turn. Keep or move those edits before undoing.' },
}
export const Restored: Story = { args: { restored: true } }
