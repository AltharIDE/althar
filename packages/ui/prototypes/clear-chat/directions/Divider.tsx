// Scrappy: where the cleared view begins: the way to the earlier conversation, and the way back.
import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { ThreadDivider } from '../../../src/thread/Furniture/Furniture'
import { proto, scrollThreadToTop, type Direction, type Talk } from '../state'

export const dividerText = {
  cleared: 'Cleared',
  earlier: 'Earlier conversation',
  show: 'Show earlier',
  back: 'Back to now',
  undo: 'Undo',
  fresh: 'Fresh session',
}
const t = dividerText

/** The divider where it first appears, at the top of the thread's view: what came before is above it, what stays below. */
export function Divider({ direction, talk }: { direction: Direction; talk: Talk }) {
  if (direction === 'Today') return null
  if (talk.wiped) {
    return (
      <AtTop>
        <ThreadDivider icon="plus">{t.fresh}</ThreadDivider>
      </AtTop>
    )
  }
  if (talk.mark === null) return null
  return (
    <AtTop key={`${talk.mark}-${talk.earlierOpen}`}>
      <Line talk={talk} />
    </AtTop>
  )
}

function AtTop({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // Once the thread has drawn what the clear changed.
    const timer = window.setTimeout(scrollThreadToTop, 250)
    return () => window.clearTimeout(timer)
  }, [])
  return <div ref={box}>{children}</div>
}

/** The cleared view's line: the earlier conversation is a press away, and the clear itself can be taken back. */
function Line({ talk }: { talk: Talk }) {
  if (talk.earlierOpen)
    return (
      <ThreadDivider icon="corner">
        {t.earlier}
        {' · '}
        <LinkButton onClick={() => proto.showEarlier(false)}>{t.back}</LinkButton>
        {talk.before !== null && (
          <>
            {' · '}
            <LinkButton onClick={proto.undoClear}>{t.undo}</LinkButton>
          </>
        )}
      </ThreadDivider>
    )
  return (
    <ThreadDivider icon="remove">
      {t.cleared}
      {' · '}
      <LinkButton onClick={() => proto.showEarlier(true)}>{t.show}</LinkButton>
      {talk.before !== null && (
        <>
          {' · '}
          <LinkButton onClick={proto.undoClear}>{t.undo}</LinkButton>
        </>
      )}
    </ThreadDivider>
  )
}
