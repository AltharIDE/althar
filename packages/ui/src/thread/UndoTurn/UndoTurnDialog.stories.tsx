import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import { Composer } from '../../composer/Composer/Composer'
import { ChangeView } from '../../outputs/ChangeView/ChangeView'
import { DiffLineKind } from '../../foundations/vocabulary'
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
  prompt = PROMPT,
  errorFiles = [],
  errorKind,
}: {
  asking?: boolean
  restored?: boolean
  busy?: boolean
  error?: string | null
  prompt?: string
  errorFiles?: ReadonlyArray<string>
  errorKind?: 'edited' | 'staged'
}) {
  const [open, setOpen] = useState(asking)
  const [undone, setUndone] = useState(restored)
  const [draft, setDraft] = useState(restored ? prompt : '')
  const [review, setReview] = useState(false)
  const [reviewed, setReviewed] = useState(false)
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
              {prompt}
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
          notice={undone ? <output>Files and conversation restored.</output> : undefined}
        />
      </div>
      {open && !review && (
        <UndoTurnDialog
          prompt={prompt}
          busy={busy}
          error={reviewed ? null : error}
          errorFiles={errorFiles}
          errorKind={errorKind}
          {...(errorFiles.length > 0
            ? {
                onReviewEdits: () => {
                  setReview(true)
                  setReviewed(true)
                },
              }
            : {})}
          onClose={() => setOpen(false)}
          onUndo={() => {
            setUndone(true)
            setDraft(prompt)
            setOpen(false)
          }}
        />
      )}
      {review && (
        <ChangeView
          branch="althar/retry-checkout"
          base="main"
          files={errorFiles.map((path) => ({ path, status: 'modified', add: 1, del: 1, uncommitted: true }))}
          selected={errorFiles[0] ?? null}
          onSelect={fn()}
          onClose={() => setReview(false)}
          view={{
            state: 'ready',
            lines: [
              { kind: DiffLineKind.Hunk, text: '@@ -8,3 +8,3 @@' },
              { kind: DiffLineKind.Context, old: 8, new: 8, text: 'export const checkoutPolicy = {' },
              { kind: DiffLineKind.Removed, old: 9, text: '  maxRetries: 20,' },
              { kind: DiffLineKind.Added, new: 9, text: '  maxRetries: 5, // manual change' },
              { kind: DiffLineKind.Context, old: 10, new: 10, text: '}' },
            ],
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
  args: { asking: true, error: 'These files changed after the turn.', errorFiles: ['src/retry.ts'], errorKind: 'edited' },
}
export const Staged: Story = {
  args: { asking: true, error: 'These files have staged changes.', errorFiles: ['src/retry.ts'], errorKind: 'staged' },
}
export const LongMessage: Story = {
  args: {
    asking: true,
    prompt:
      'Raise the retry limit to twenty and remove the exponential backoff in the checkout service. Keep the timeout behavior, preserve the existing error messages, and make sure we do not retry payment authorization. Update the provider adapter and the integration tests as well.',
    error: 'These files changed after the turn.',
    errorFiles: ['packages/runtime/src/providers/retry-policy/RetryWithExponentialBackoffAndJitter.ts'],
    errorKind: 'edited',
  },
}
export const Restored: Story = { args: { restored: true } }
