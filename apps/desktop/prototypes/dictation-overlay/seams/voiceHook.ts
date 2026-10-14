// Throwaway: what a screen's composer shows of the dictation, from the store rather than from a microphone of its own.
import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react'

import { DictationSetup } from '@althar/ui'

import type { Voice } from '../../../src/renderer/shared/dictation/useDictation'
import { act, clock, drafts, heardOf, joinText, OPEN, QUIET, screenGone, store, useLive } from '../voice'

export function useVoiceFor(key: string, setDraft: Dispatch<SetStateAction<string>>): Voice {
  const live = useLive()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const session = live.session
  const mine = session.to === key
  const onScreen = (live.onScreen[key] ?? 0) > 0

  // Its field, so what is written while it's away can land in it, and leave it again.
  useEffect(() => {
    const set = (change: (draft: string) => string) => setDraft((draft) => change(draft))
    drafts.set(key, set)
    return () => {
      if (drafts.get(key) === set) drafts.delete(key)
    }
  }, [key, setDraft])

  // Today: leaving the screen takes what is being said with it.
  useEffect(() => () => screenGone(key), [key])
  useEffect(() => {
    if (live.idea === 'T' && mine && OPEN.has(session.phase) && !session.kept) act.lose()
  }, [live.idea, mine, session.phase, session.kept])

  // Written down while its composer shows: into the field, where the person carries on with it.
  useEffect(() => {
    if (!mine || !onScreen || session.phase !== 'done') return
    const { session: now, moved } = store.get()
    const text = now.text
    setDraft((draft) => joinText(draft, text))
    store.set({
      session: { ...now, phase: 'idle', text: '' },
      ...(moved !== null && moved.to === key && moved.text === null ? { moved: { ...moved, text } } : {}),
    })
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [mine, onScreen, session.phase, key, setDraft])

  // Words written for it while it was away (moved back to it): into its field.
  const waiting = live.pending[key]
  useEffect(() => {
    if (waiting === undefined) return
    setDraft((draft) => joinText(draft, waiting))
    const { [key]: _gone, ...rest } = store.get().pending
    store.set({ pending: rest })
  }, [waiting, key, setDraft])

  const listening = mine && (session.phase === 'listening' || session.phase === 'paused')
  const words = heardOf(session)
  const interim = mine && (listening || session.phase === 'writing') ? joinText(words.settled, words.unsettled) : ''
  const failed = mine && session.phase === 'failed'
  const dictation = {
    elapsed: listening ? clock(session.seconds) : null,
    levels: listening ? session.levels : QUIET,
    interim,
    kbd: '⌘⇧D',
    busy: mine && session.phase === 'writing',
    expanded: failed,
    onStart: () => act.start(key),
    onStop: act.stop,
    // Which thread it writes to, for the composer seam to say it's on screen.
    __key: key,
  }
  return {
    dictation,
    tray: failed
      ? {
          state: { kind: DictationSetup.Failed, said: clock(session.seconds) },
          onRetry: act.retry,
          onDiscard: act.cancel,
          onDismiss: act.cancel,
        }
      : null,
    inputRef,
  }
}
