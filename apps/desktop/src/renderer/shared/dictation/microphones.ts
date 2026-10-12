import { useEffect, useState, useSyncExternalStore } from 'react'

/*
 * Which microphone dictation hears. The system's default unless the person
 * chose another; the choice is kept across launches, by its id and its name,
 * since an id may not outlive the app. A chosen microphone that isn't there
 * (pulled out, or renamed) is heard as the default, and comes back when it
 * does. The system names its microphones only once Althar may use one, so
 * until then there is only the default to choose.
 */

export interface Microphone {
  readonly id: string
  readonly label: string
}

const STORED = 'althar.dictation.microphone'
const listeners = new Set<() => void>()
let last: { readonly raw: string | null; readonly chosen: Microphone | null } = { raw: null, chosen: null }

const isMicrophone = (value: unknown): value is Microphone =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { label?: unknown }).label === 'string'

/** The chosen microphone, read again only when storage changed; null for the system's default. */
const readChosen = (): Microphone | null => {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORED)
  } catch {
    return last.chosen
  }
  if (raw === last.raw) return last.chosen
  let chosen: Microphone | null = null
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (isMicrophone(parsed)) chosen = { id: parsed.id, label: parsed.label }
  } catch {
    chosen = null
  }
  last = { raw, chosen }
  return chosen
}

/** Chooses a microphone for dictation; null for the system's default. */
export const chooseMicrophone = (microphone: Microphone | null) => {
  const raw = microphone === null ? null : JSON.stringify({ id: microphone.id, label: microphone.label })
  last = { raw, chosen: microphone }
  try {
    if (raw === null) window.localStorage.removeItem(STORED)
    else window.localStorage.setItem(STORED, raw)
  } catch {
    // Kept for this window only.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useChosenMicrophone = (): Microphone | null => useSyncExternalStore(subscribe, readChosen)

/* The system's own stand-ins for its default, which the list's first choice already is. */
const STAND_INS = new Set(['default', 'communications'])

/** The microphones there are, by name; none until the system names them. */
export const microphonesOf = (devices: ReadonlyArray<Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>>): Array<Microphone> =>
  devices
    .filter((device) => device.kind === 'audioinput' && device.label !== '' && !STAND_INS.has(device.deviceId))
    .map((device) => ({ id: device.deviceId, label: device.label }))

/**
 * The microphone to hear: the chosen one where it is there, by id or else by
 * name; the default (null) where it isn't. While the system names none, the
 * chosen one's id, which the recorder hears if it can and passes over if not.
 */
export const microphoneToUse = (chosen: Microphone | null, there: ReadonlyArray<Microphone>): string | null => {
  if (chosen === null) return null
  if (there.length === 0) return chosen.id
  return (there.find((m) => m.id === chosen.id) ?? there.find((m) => m.label === chosen.label))?.id ?? null
}

/** The microphones there are, again as one comes or goes; `refresh` reads them again, as once the system names them. */
export const useMicrophones = (): { readonly microphones: ReadonlyArray<Microphone>; readonly refresh: () => void } => {
  const [microphones, setMicrophones] = useState<ReadonlyArray<Microphone>>([])
  const [reads, setReads] = useState(0)
  useEffect(() => {
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
    if (devices?.enumerateDevices === undefined) return
    let live = true
    const read = () =>
      void devices
        .enumerateDevices()
        .then((all) => {
          if (!live) return
          const next = microphonesOf(all)
          setMicrophones((now) =>
            now.length === next.length && now.every((m, i) => m.id === next[i]?.id && m.label === next[i]?.label) ? now : next,
          )
        })
        .catch(() => {})
    read()
    devices.addEventListener?.('devicechange', read)
    return () => {
      live = false
      devices.removeEventListener?.('devicechange', read)
    }
  }, [reads])
  return { microphones, refresh: () => setReads((n) => n + 1) }
}
