// Throwaway: what the person sent from a dictation, by thread, so the fake runtime's threads have it.
const sent = new Map<string, ReadonlyArray<{ readonly text: string; readonly at: number }>>()
const listeners = new Set<() => void>()

export const sentTo = (key: string) => sent.get(key) ?? []

export const addSent = (key: string, text: string) => {
  sent.set(key, [...sentTo(key), { text, at: Date.now() }])
  listeners.forEach((listener) => listener())
}

export const onSent = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
