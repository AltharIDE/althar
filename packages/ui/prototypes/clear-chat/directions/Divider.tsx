// Scrappy: what each direction draws where the conversation was cleared, forgotten or begun again.
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { Button } from '../../../src/primitives/Button/Button'
import { Dialog } from '../../../src/primitives/Dialog/Dialog'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { ThreadDivider } from '../../../src/thread/Furniture/Furniture'
import { conversationsOf, type Direction, proto, type Talk } from '../state'
import s from './directions.module.css'

export const dividerText = {
  earlier: 'Earlier conversation',
  show: 'Show',
  cleared: 'Cleared',
  showEarlier: 'Show earlier',
  hideEarlier: 'Hide earlier',
  undo: 'Undo',
  fresh: 'New conversation',
  readLast: 'Read the last one',
  back: 'Back to now',
  delete: 'Delete…',
  deleteTitle: 'Delete this conversation?',
  deleteAbout: 'The coordinator forgets it, and what it carried over from it. Tasks and the project’s notes stay.',
  deleteIt: 'Delete conversation',
  cancel: 'Cancel',
}
const t = dividerText

const clock = (iso: string | null) =>
  iso === null ? '' : new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** When a conversation ran, as its divider says it: from its first word to its last. */
const span = (began: string | null, ended: string | null) => `${clock(began)}–${clock(ended)}`

/** The divider where it first appears, at the top of the thread's view: what was cleared is above it, what stays below. */
export function Divider({ direction, talk }: { direction: Direction; talk: Talk }) {
  return (
    <AtTop key={direction === 'C' ? `c-${talk.starts.length}-${talk.viewing ?? 'now'}` : talk.wiped ? 'wiped' : 'cleared'}>
      <Line direction={direction} talk={talk} />
    </AtTop>
  )
}

function AtTop({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // Once the thread has followed its end, as it does when what it holds changes.
    const timer = window.setTimeout(() => box.current?.scrollIntoView({ block: 'start' }), 250)
    return () => window.clearTimeout(timer)
  }, [])
  return <div ref={box}>{children}</div>
}

function Line({ direction, talk }: { direction: Direction; talk: Talk }) {
  if (direction === 'C') return <ConversationDivider talk={talk} />
  // Forgotten: nothing above it; what follows is all the coordinator knows of the conversation.
  if (talk.wiped) return <ThreadDivider icon="plus">{t.fresh}</ThreadDivider>
  if (talk.cleared === null) return null
  const open = talk.cleared.open
  // A: put away, it is the earlier conversation, there to show; its undo is at the composer's edge.
  if (direction === 'A')
    return (
      <ThreadDivider icon={open ? 'down' : 'up'} action={open ? t.hideEarlier : t.show} onAction={() => proto.showEarlier(!open)}>
        {open ? t.cleared : t.earlier}
      </ThreadDivider>
    )
  // B: one line, undone from it until something is said.
  const undoable = talk.before !== null && !talk.saidSince
  return (
    <ThreadDivider icon={open ? 'down' : 'up'} action={open ? t.hideEarlier : t.showEarlier} onAction={() => proto.showEarlier(!open)}>
      {t.cleared}
      {undoable && (
        <>
          {' · '}
          <LinkButton onClick={proto.undo}>{t.undo}</LinkButton>
        </>
      )}
    </ThreadDivider>
  )
}

/** C: the head of the current conversation, with the way to the last one; or of an earlier one, open to read, deleted from there. */
function ConversationDivider({ talk }: { talk: Talk }) {
  const [deleting, setDeleting] = useState(false)
  const all = conversationsOf(talk)
  if (talk.viewing !== null) {
    const one = all.find((each) => each.index === talk.viewing)
    const index = talk.viewing
    return (
      <>
        <ThreadDivider icon="clock" action={t.back} onAction={() => proto.view(null)}>
          {span(one?.began ?? null, one?.ended ?? null)}
          {' · '}
          <LinkButton className={s.danger} onClick={() => setDeleting(true)}>
            {t.delete}
          </LinkButton>
        </ThreadDivider>
        {deleting && (
          <Dialog
            title={t.deleteTitle}
            description={t.deleteAbout}
            onClose={() => setDeleting(false)}
            actions={
              <>
                <Button variant="quiet" onClick={() => setDeleting(false)}>
                  {t.cancel}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDeleting(false)
                    proto.deleteConversation(index)
                  }}
                >
                  {t.deleteIt}
                </Button>
              </>
            }
          />
        )}
      </>
    )
  }
  const last = all.filter((each) => !each.current).at(-1)
  const undoable = talk.before !== null && !talk.saidSince
  const words = (
    <>
      {t.fresh}
      {undoable && (
        <>
          {' · '}
          <LinkButton onClick={proto.undo}>{t.undo}</LinkButton>
        </>
      )}
    </>
  )
  return last === undefined ? (
    <ThreadDivider icon="plus">{words}</ThreadDivider>
  ) : (
    <ThreadDivider icon="plus" action={t.readLast} onAction={() => proto.view(last.index)}>
      {words}
    </ThreadDivider>
  )
}
