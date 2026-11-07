import { useEffect, useRef, useState } from 'react'

import type { DictationPermission } from '@althar/ui'

import { type DictationState, useServices } from '../../data/services'
import { chooseMicrophone, type Microphone, microphoneToUse, useChosenMicrophone, useMicrophones } from '../../shared/dictation/microphones'
import { bytes } from '../../shared/dictation/text'

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
    readonly state: 'present' | 'absent' | 'downloading'
    readonly onDisk: string
    readonly size: string
    readonly got: string
  }
  readonly removing: boolean
  /** Remove didn't work. */
  readonly failed: boolean
  readonly remove: () => void
}

/** Whether the system lets Althar use the microphone, as the settings say it: Linux has no setting to read. */
export const permissionOf = (state: DictationState): DictationPermission =>
  state.platform === 'linux' ? 'unknown' : state.microphone === 'granted' ? 'allowed' : state.microphone === 'ask' ? 'ask' : 'denied'

/** Null where the window can't dictate, and until the main process has said how dictation stands. */
export const useDictationSettings = (): DictationSettingsModel | null => {
  const { host } = useServices()
  const voice = host.dictation
  const [state, setState] = useState<DictationState | null>(null)
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
          setState(next)
        })
        .catch(() => {})
    read()
    const off = voice.onEvent((event) => {
      const type = (event as { type?: unknown } | null)?.type
      if (type !== 'progress' || !downloading.current) read()
    })
    return () => {
      live = false
      off()
    }
  }, [voice])

  if (voice === undefined || state === null) return null
  const { model } = state
  const onDisk = model.ready ? model.size : model.got
  return {
    microphones,
    microphone: microphoneToUse(chosen, microphones),
    choose: (id) => chooseMicrophone(id === null ? null : (microphones.find((m) => m.id === id) ?? null)),
    permission: permissionOf(state),
    ...(state.settings ? { openSettings: () => void voice.openSettings('privacy') } : {}),
    model: {
      name: model.name,
      state: model.downloading ? 'downloading' : model.ready ? 'present' : 'absent',
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
        .then(() => voice.state())
        .then(setState)
        .catch(() => setFailed(true))
        .finally(() => setRemoving(false))
    },
  }
}
