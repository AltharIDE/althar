// Throwaway: E, the words go where you look. Into the composer on screen, addressed to it, with a line over it to send them where they were going instead (the seam draws that); where a screen has no composer, a pill.
import { IconButton, LinkButton } from '@althar/ui'

import { act } from '../voice'
import { Pill } from './A'
import { After, Editor, Failed, statusOf, To, type View, Words } from './common'
import s from './E.module.css'
import { useAboveComposer } from './place'

export function E({ view, area }: { view: View; area: HTMLElement | null }) {
  const above = useAboveComposer(area)
  const { session, live } = view
  if (!view.shown) return null
  const open = live.open || session.phase === 'done' || session.phase === 'failed'
  // Sent back where it was going, it still goes there while the person looks here: one press brings it here.
  const bringHere = view.here !== null && (session.phase === 'listening' || session.phase === 'paused' || session.phase === 'writing')
  return (
    <div className={s.float} style={{ bottom: above }} data-overlay="">
      {open ? (
        <section className={s.card} aria-label="Dictation">
          <header className={s.head}>
            <To address={view.to} />
            <span className={s.grow} />
            <span className={s.status}>{statusOf(view)}</span>
            <IconButton icon="chevronD" size="small" label="Make it small" onClick={() => act.open(false)} />
          </header>
          {session.phase === 'done' ? (
            <Editor view={view} rows={4} />
          ) : session.phase === 'failed' ? (
            <Failed view={view} />
          ) : session.phase === 'sent' || session.phase === 'cancelled' ? (
            <After view={view} />
          ) : (
            <Words view={view} className={s.words} />
          )}
        </section>
      ) : (
        <Pill view={view} onOpen={() => act.open(true)} />
      )}
      {bringHere && view.here !== null && (
        <p className={s.here}>
          <LinkButton onClick={() => act.start(view.here?.key ?? '')}>Send it to this task instead</LinkButton>
        </p>
      )}
    </div>
  )
}
