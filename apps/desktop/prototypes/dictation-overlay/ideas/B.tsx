// Throwaway: B, a bar along the bottom of the window, as a call has, taking its own room so it covers nothing; the latest words live, the whole of it a click away.
import { Button, Icon, IconButton } from '@althar/ui'

import { act } from '../voice'
import { After, Controls, Editor, Failed, Seen, Send, statusOf, tailOf, To, type View, Wave, Words, Writing } from './common'
import s from './B.module.css'

export function B({ view }: { view: View }) {
  const { session, live } = view
  if (!view.shown) return null
  const open = live.open
  const lingering = session.phase === 'sent' || session.phase === 'cancelled'
  const tail = tailOf(view, 22)
  const toggle = () => act.open(!open)
  return (
    <section className={s.bar} aria-label="Dictation">
      {open && !lingering && (
        <div className={s.sheet}>
          <div className={s.sheetIn}>
            <header className={s.sheetHead}>
              <To address={view.to} />
              <span className={s.grow} />
              <span className={s.quiet}>{statusOf(view)}</span>
              <IconButton icon="chevronD" size="small" label="Show only the latest words" onClick={() => act.open(false)} />
            </header>
            {session.phase === 'done' ? (
              <Editor view={view} rows={6} />
            ) : session.phase === 'failed' ? (
              <Failed view={view} />
            ) : (
              <Words view={view} className={s.words} />
            )}
            <Seen view={view} />
          </div>
        </div>
      )}
      <div className={s.line}>
        {lingering ? (
          <After view={view} />
        ) : (
          <>
            <span className={s.state}>
              {session.phase === 'writing' ? (
                <Writing view={view} />
              ) : session.phase === 'done' ? (
                <>
                  <Icon name="check" size={12} />
                  Written
                </>
              ) : session.phase === 'failed' ? (
                <>
                  <Icon name="stop" size={12} />
                  Couldn’t write it down
                </>
              ) : (
                <>
                  <Wave levels={session.levels} className={s.wave} />
                  {session.phase === 'paused' ? `Paused · ${view.elapsed}` : view.elapsed}
                </>
              )}
            </span>
            <To address={view.to} className={s.to} />
            <button type="button" className={s.latest} onClick={toggle} aria-expanded={open}>
              {session.phase === 'done' ? (
                <span className={s.quiet}>
                  {tail.text.length > 0 ? `“${session.text.slice(0, 90)}${session.text.length > 90 ? '…' : ''}”` : ''}{' '}
                  <span className={s.read}>{open ? 'Hide' : 'Read and change it'}</span>
                </span>
              ) : session.phase === 'failed' ? (
                <span className={s.quiet}>What you said ({view.elapsed}) is kept.</span>
              ) : (
                <span className={s.flow}>
                  {tail.cut && <span className={s.quiet}>… </span>}
                  {tail.text}
                </span>
              )}
            </button>
            <span className={s.controls}>
              {session.phase === 'failed' ? (
                <>
                  <Button size="small" onClick={act.retry}>
                    Try again
                  </Button>
                  <IconButton icon="close" size="small" label="Throw it away" onClick={act.cancel} />
                </>
              ) : (
                <>
                  <Controls view={view} />
                  <Send view={view} />
                </>
              )}
            </span>
          </>
        )}
      </div>
    </section>
  )
}
