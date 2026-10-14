// Throwaway: D, on the tab of the project it goes to: your voice and the time on the tab, and the words in a peek that opens from it.
import { Icon, Popover, Spinner } from '@althar/ui'

import { act } from '../voice'
import { After, Controls, Editor, Failed, Seen, Send, statusOf, To, type View, Wave, Words, Writing } from './common'
import seams from '../seams/seams.module.css'
import s from './D.module.css'

/** What the tab carries, by where the dictation stands. */
function OnTab({ view }: { view: View }) {
  const { session } = view
  switch (session.phase) {
    case 'listening':
      return (
        <>
          <Wave levels={session.levels.slice(-7)} />
          {view.elapsed}
        </>
      )
    case 'paused':
      return (
        <>
          <Icon name="hold" size={11} />
          Paused
        </>
      )
    case 'writing':
      return (
        <>
          <Spinner size="small" label="Writing it down" />
          Writing
        </>
      )
    case 'done':
      return (
        <>
          <Icon name="up" size={11} />
          To send
        </>
      )
    case 'failed':
      return (
        <>
          <Icon name="stop" size={11} />
          Not written
        </>
      )
    case 'sent':
      return (
        <>
          <Icon name="check" size={11} />
          Sent
        </>
      )
    case 'cancelled':
      return <>Thrown away</>
    default:
      return null
  }
}

export function D({ view }: { view: View }) {
  const { session, live } = view
  if (!view.shown) return null
  // Written, or not, it waits on the person: the tab says so in violet, as what waits on you does.
  const yours = session.phase === 'done' || session.phase === 'failed'
  return (
    <Popover
      label="Dictation"
      placement="below"
      align="start"
      width={460}
      padded={false}
      initialFocus="panel"
      open={live.open}
      onOpenChange={act.open}
      trigger={
        <button type="button" className={`${seams.onTab} ${yours ? seams.onTabDone : ''}`} aria-label={`Dictation: ${statusOf(view)}`}>
          <OnTab view={view} />
        </button>
      }
    >
      <div className={s.peek}>
        <header className={s.head}>
          <To address={view.to} />
          <span className={s.grow} />
          <span className={s.status}>{session.phase === 'writing' ? null : statusOf(view)}</span>
        </header>
        {session.phase === 'done' ? (
          <Editor view={view} rows={6} />
        ) : session.phase === 'failed' ? (
          <Failed view={view} />
        ) : session.phase === 'sent' || session.phase === 'cancelled' ? (
          <After view={view} />
        ) : (
          <Words view={view} className={s.words} />
        )}
        <Seen view={view} />
        {session.phase !== 'failed' && session.phase !== 'sent' && session.phase !== 'cancelled' && (
          <footer className={s.foot}>
            {session.phase === 'writing' ? <Writing view={view} /> : null}
            <span className={s.grow} />
            <Controls view={view} />
            <Send view={view} />
          </footer>
        )}
      </div>
    </Popover>
  )
}
