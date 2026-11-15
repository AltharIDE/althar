import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { DictationSetup, DictationTray } from '@althar/ui'

import { draftKey, draftOf, setDraftDictated, setDraftText } from '../drafts'
import s from './Carried.module.css'
import { changeSession, type Destination } from './sessions'
import { useDictation } from './useDictation'

/*
 * Dictation said from anywhere (ADR-017). The shortcut starts it wherever the
 * person is: where no composer shows (the home, the board, the settings, a
 * page, a task's outputs) it is this that listens, in a thread of its own
 * that is carried from the first word, so its pill (`Carried.tsx`) is at the
 * window's foot, or over the composer the person goes to. It is written down
 * as any is, and then they choose where it goes: a project's coordinator, a
 * task, an aside (`placeLoose`), or into the composer on screen, or away.
 *
 * The first time, and where the microphone is refused, the tray that a
 * composer would carry says so here, at the foot, over where the pill will be.
 */

export const looseText = {
  to: 'Not placed yet',
}

/** Where what was said from anywhere can go: a project's coordinator, or a task's thread (an aside is one). */
export type Place = { readonly kind: 'coordinator'; readonly projectId: string } | { readonly kind: 'task'; readonly threadId: string }

const to: Destination = { to: looseText.to, back: null, threadId: null, send: '', take: '' }

/** Puts what was said from anywhere into `place`'s draft, after what is there, and leaves nothing carried. */
export const placeLoose = (place: Place) => {
  const { text: said, dictated } = draftOf(draftKey.loose)
  const text = said.trim()
  if (text === '') return
  const key = place.kind === 'coordinator' ? draftKey.coordinator(place.projectId) : draftKey.task(place.threadId)
  setDraftText(key, (now) => (now.trim() === '' ? text : `${now.trimEnd()}\n\n${text}`))
  // The agent that reads it is told it was dictated.
  if (dictated) setDraftDictated(key, true)
  setDraftText(draftKey.loose, '')
  changeSession(draftKey.loose, { away: null, arrived: null })
}

/** The window's own dictation, mounted once under the tabs. `projectId`: the project whose tab has the window, whose names it spells. */
export function LooseDictation({ projectId }: { projectId: string | null }) {
  const voice = useDictation(draftKey.loose, { loose: true, projectId, to })
  // What was said and not placed before the window was closed is carried again, written, to place.
  useEffect(() => {
    if (draftOf(draftKey.loose).text.trim() === '') {
      setDraftText(draftKey.loose, '')
      setDraftDictated(draftKey.loose, false)
    } else changeSession(draftKey.loose, { away: Date.now() })
  }, [])
  // What couldn't be written down is the pill's to say, with its own Try again.
  const tray = voice.tray?.state.kind === DictationSetup.Failed ? null : voice.tray
  if (tray === null) return null
  // At the body's end, outside the app's root, so a page in a tab steps aside for it (`cover.ts`).
  return createPortal(
    <div className={s.dock} data-state="open">
      <DictationTray {...tray} className={s.tray} />
    </div>,
    document.body,
  )
}
