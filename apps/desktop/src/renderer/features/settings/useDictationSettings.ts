import { useEffect, useRef, useState } from 'react'

import type { DictationPermission, DictationSettingsText } from '@althar/ui'

import { type DictationState, useServices } from '../../data/services'
import { chooseMicrophone, type Microphone, microphoneToUse, useChosenMicrophone, useMicrophones } from '../../shared/dictation/microphones'
import { bytes, settingsText } from '../../shared/dictation/text'

/*
 * Dictation's settings: the microphone it hears (kept, and the one the
 * recorder opens), whether the system lets Althar use one, and the speech
 * model on disk, which Remove takes away; the next dictation brings it down
 * again. Read from the main process, and again whenever it says the model
 * came, stopped, or went.
 */

export interface DictationSettingsModel {
  readonly microphones: ReadonlyArray<Microphone>
  /** The chosen input's id; null for the system's default. */
  readonly microphone: string | null
  readonly choose: (id: string | null) => void
  readonly permission: DictationPermission
  /** Opens the system's microphone settings; absent where there are none (Linux). */
  readonly openSettings?: () => void
  readonly model: {
    readonly name: string
    readonly state: 'present' | 'partial' | 'absent' | 'downloading'
    readonly onDisk: string
    readonly size: string
    readonly got: string
  }
  /** The words for this system. */
  readonly text: Partial<DictationSettingsText>
  readonly removing: boolean
  /** Remove didn't work. */
  readonly failed: boolean
  readonly remove: () => void
}

/** Whether the system lets Althar use the microphone, as the settings say it: Linux has no setting to read. */
export const permissionOf = (state: DictationState): DictationPermission =>
  state.platform === 'linux' ? 'unknown' : state.microphone === 'granted' ? 'allowed' : state.microphone === 'ask' ? 'ask' : 'denied'

/** Where dictation stands for the section: it can't here, the main process hasn't said yet, it couldn't be read, or the settings. */
export type DictationSettings =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unreadable'; readonly retry: () => void }
  | ({ readonly kind: 'ready' } & DictationSettingsModel)

export const useDictationSettings = (): DictationSettings => {
  const { host } = useServices()
  const voice = host.dictation
  const [state, setState] = useState<DictationState | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [removing, setRemoving] = useState(false)
  const [failed, setFailed] = useState(false)
  /* Whether a download is known to be under way: the first progress from another window reads the state again. */
  const downloading = useRef(false)
  const chosen = useChosenMicrophone()
  const { microphones } = useMicrophones()

  useEffect(() => {
    if (voice === undefined) return
    let live = true
    const read = () =>
      void voice
        .state()
        .then((next) => {
          if (!live) return
          downloading.current = next.model.downloading
          setUnreadable(false)
          setState(next)
        })
        .catch(() => live && setUnreadable(true))
    read()
    const off = voice.onEvent((event) => {
      const e = event as { type?: unknown; got?: unknown } | null
      if (e?.type === 'progress' && downloading.current && typeof e.got === 'number') {
        const got = e.got
        setState((s) => (s === null ? s : { ...s, model: { ...s.model, got } }))
      } else read()
    })
    return () => {
      live = false
      off()
    }
  }, [voice, attempt])

  if (voice === undefined) return { kind: 'none' }
  if (state === null) return unreadable ? { kind: 'unreadable', retry: () => setAttempt((n) => n + 1) } : { kind: 'loading' }
  const { model } = state
  const onDisk = model.ready ? model.size : model.got
  return {
    kind: 'ready',
    text: settingsText(state.platform),
    microphones,
    microphone: microphoneToUse(chosen, microphones),
    choose: (id) => chooseMicrophone(id === null ? null : (microphones.find((m) => m.id === id) ?? null)),
    permission: permissionOf(state),
    ...(state.settings ? { openSettings: () => void voice.openSettings('privacy') } : {}),
    model: {
      name: model.name,
      state: model.downloading ? 'downloading' : model.ready ? 'present' : model.got > 0 ? 'partial' : 'absent',
      onDisk: bytes(onDisk),
      size: bytes(model.size),
      got: bytes(model.got),
    },
    removing,
    failed,
    remove: () => {
      setRemoving(true)
      setFailed(false)
      void voice
        .remove()
        .catch(() => setFailed(true))
        .finally(() => setRemoving(false))
    },
  }
}
