import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ARTIFACTS, NOTES_KEPT, NOTES_SEEN, STEPS_418 } from '../../fixtures/chrome'
import { ACCEPT, CALL } from '../../fixtures/dock'
import { OPUS } from '../../fixtures/models'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { AcceptPeek } from '../AcceptPeek/AcceptPeek'
import { CallPeek } from '../CallPeek/CallPeek'
import { ListPeek } from '../ListPeek/ListPeek'
import { SettledPeek, WorkPeek } from '../WorkPeek/WorkPeek'
import { Dock } from './Dock'

/* The dock beside the board, at its width, holding one peek. */
function Docked({
  peek,
  onClose,
}: {
  peek: 'call' | 'accept' | 'work' | 'waiting' | 'settled' | 'knowledge' | 'artifacts'
  onClose: () => void
}) {
  const close = onClose
  const frame = (name: string, sub: string | undefined, body: ReactNode, call = false) => (
    <div style={{ width: 420, height: '100vh', marginLeft: 'auto' }}>
      <Dock label={name} name={name} sub={sub} call={call} onClose={close}>
        {body}
      </Dock>
    </div>
  )
  switch (peek) {
    case 'call':
      return frame('Decision', 'Repair · task 418 · 18m ago', <CallPeek {...CALL} onRecord={fn()} />, true)
    case 'accept':
      return frame('Ready to accept', 'task 416 · 9m ago', <AcceptPeek {...ACCEPT} onAccept={fn()} onSendBack={fn()} />, true)
    case 'work':
      return frame(
        '418',
        'ch/418-token-refresh · 6m',
        <WorkPeek
          title="Repair token refresh on privilege change"
          note="The security review was added after the graph touched authentication files."
          steps={STEPS_418}
          lead={OPUS}
        />,
      )
    case 'waiting':
      return frame(
        '429',
        'no branch · queued 40m',
        <WorkPeek title="Sign webhook v2 payloads with rotating keys" waiting="Starts when 419 merges" />,
      )
    case 'settled':
      return frame(
        '414',
        'Merged · 3h ago',
        <SettledPeek title="Add idempotency keys to the refund endpoint" meta="PR 1184 · 2 review rounds" />,
      )
    case 'knowledge':
      return frame(
        'Knowledge',
        undefined,
        <ListPeek
          action={<ActionButton kbd="⇧K">Open knowledge full size</ActionButton>}
          about="Held by the project. Every task starts with its notes, and adds what it saw."
          sections={[
            { label: 'Notes', entries: NOTES_KEPT },
            { label: 'Seen in tasks', entries: NOTES_SEEN },
          ]}
          onOpen={fn()}
        />,
      )
    case 'artifacts':
      return frame(
        'Artifacts',
        undefined,
        <ListPeek
          about="What tasks wrote that is worth keeping, and isn’t in the repository."
          sections={[{ entries: ARTIFACTS }]}
          onOpen={fn()}
        />,
      )
  }
}

const meta = {
  title: 'Dock/Dock',
  component: Docked,
  parameters: { layout: 'fullscreen' },
  args: { peek: 'call', onClose: fn() },
} satisfies Meta<typeof Docked>
export default meta
type Story = StoryObj<typeof meta>

/** A call of yours, opened from the board: its head is violet. */
export const Call: Story = {}
export const Accept: Story = { args: { peek: 'accept' } }
export const Work: Story = { args: { peek: 'work' } }
/** Not started: no steps yet, only what it waits for. */
export const Waiting: Story = { args: { peek: 'waiting' } }
export const Settled: Story = { args: { peek: 'settled' } }
export const Knowledge: Story = { args: { peek: 'knowledge' } }
export const Artifacts: Story = { args: { peek: 'artifacts' } }

/** Escape takes back the note first; the next Escape closes the dock. */
export const EscapingANote: Story = {
  args: { peek: 'accept' },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await expect(c.getByRole('textbox')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByRole('textbox')).toBeNull()
    await expect(args.onClose).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalledOnce()
  },
}
