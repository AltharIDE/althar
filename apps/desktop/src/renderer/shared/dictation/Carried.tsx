import { createContext, useContext, useEffect, useState } from 'react'

import { DictationPill, type DictationPillPhase } from '@althar/ui'

import { useServices } from '../../data/services'
import { draftOf, setDraftDictated, setDraftText, useDraftOf } from '../drafts'
import s from './Carried.module.css'
import { changeSession, type Destination, handlesOf, sessionOf, useCarrying, useSession } from './sessions'
import { lengthOf } from './text'
import { cancelIn, SHORTCUT, stopIn, writeIn } from './useDictation'

/*
 * Dictation carried with the person once they leave its composer (ADR-017,
 * `sessions.ts`). It shows over the composer on screen, above all that floats
 * there, so it covers none of it; where no composer shows (the home, the
 * board), at the window's foot. It says whose it is, and stops, throws away,
 * and once written, sends it there, or moves it into the composer on screen
 * instead. Sending from here says it as its composer would when nothing else
 * is picked: after what is under way. A task with no lead on it is sent from
 * its own composer, which starts one; so is a draft with images.
 */

export const carriedText = {
  didntSend: "It didn't send. It's still here, to send again.",
}

/** Goes back to a thread's composer: the window's router, given by its frame. */
export const CarriedBack = createContext<(back: Destination['back']) => void>(() => {})

/** Over the composer of `here`: dictation carried from another thread, if any. */
export function CarriedOver({ here }: { here: string }) {
  const { key } = useCarrying()
  if (key === null || key === here) return null
  return <Carried thread={key} here={here} />
}

/** At the window's foot, where no composer shows. */
export function CarriedAtFoot() {
  const { key, here } = useCarrying()
  if (key === null || here !== null) return null
  return (
    <div className={s.foot}>
      <Carried thread={key} here={null} />
    </div>
  )
}

const isShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === 'd' && (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey

function Carried({ thread, here }: { thread: string; here: string | null }) {
  const goBack = useContext(CarriedBack)
  const { client } = useServices()
  const session = useSession(thread)
  const draft = useDraftOf(thread)
  const [error, setError] = useState<string | null>(null)
  const sending = session.sending

  // The shortcut stops what is carried, before the composer on screen would start its own.
  const listening = session.phase === 'listening'
  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) stopIn(thread)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, thread])

  const to = handlesOf(thread).to
  if (to === null) return null
  const there = here === null ? null : handlesOf(here).to

  const phase: DictationPillPhase =
    session.phase === 'listening' ? 'listening' : session.phase === 'writing' ? 'writing' : session.failed !== null ? 'failed' : 'written'
  // Dealt with: nothing carried, and no note in its composer that it came while the person was away.
  const done = () => changeSession(thread, { away: null, arrived: null })

  // Sent once, however often the pill is drawn again meanwhile. It leaves the draft as it goes, so its composer has nothing of it to send again, and what the person writes there meanwhile is theirs: untouched once it is there, after it if it didn't go.
  const send = (threadId: string) => {
    const body = draftOf(thread).text.trim()
    const dictated = draftOf(thread).dictated
    const sent = sessionOf(thread)
    if (body === '' || sent.sending !== null) return
    changeSession(thread, { sending: body })
    setDraftText(thread, '')
    setError(null)
    client.send({ threadId, body, disposition: 'after_current', ...(dictated ? { dictated } : {}) }).then(
      () => {
        changeSession(thread, { sending: null })
        // Only what was carried as it went is dealt with: dictation started since, and carried in turn, goes on.
        const now = sessionOf(thread)
        if (now.away === sent.away && now.phase === sent.phase && now.failed === null && draftOf(thread).text.trim() === '') done()
      },
      () => {
        setDraftText(thread, (now) => (now.trim() === '' ? body : `${body}\n\n${now.trimStart()}`))
        if (dictated) setDraftDictated(thread, true)
        changeSession(thread, { sending: null })
        setError(carriedText.didntSend)
      },
    )
  }

  // Into the composer on screen instead, after what is there, and its field takes the cursor.
  const move = () => {
    if (here === null) return
    const { dictated, text: said } = draftOf(thread)
    const text = said.trim()
    setDraftText(here, (now) => (now.trim() === '' ? text : `${now.trimEnd()}\n\n${text}`))
    if (dictated) setDraftDictated(here, true)
    setDraftText(thread, '')
    done()
    handlesOf(here).field?.current?.focus()
  }

  const failed = session.failed
  const target = to.threadId
  return (
    <DictationPill
      phase={phase}
      to={to.to}
      elapsed={listening ? lengthOf(session.seconds) : null}
      levels={session.levels}
      words={phase === 'written' ? (sending ?? draft.text) : session.interim}
      onChange={(text) => setDraftText(thread, text)}
      said={failed === null ? '' : lengthOf(failed.seconds)}
      kbd={SHORTCUT}
      onStop={() => stopIn(thread)}
      onDiscard={() => (phase === 'failed' ? changeSession(thread, { failed: null, away: null }) : cancelIn(thread))}
      onBack={() => goBack(to.back)}
      // Kept, its composer still says it came while the person was away.
      onKeep={() => changeSession(thread, { away: null })}
      onRetry={() => {
        if (failed === null) return
        changeSession(thread, { failed: null })
        void writeIn(thread, failed, null)
      }}
      {...(target !== null && draft.images.length === 0
        ? { send: { label: to.send, busy: sending !== null, onSend: () => send(target) } }
        : {})}
      {...(there !== null && here !== null && sending === null ? { move: { label: there.take, onMove: move } } : {})}
      error={error}
    />
  )
}
