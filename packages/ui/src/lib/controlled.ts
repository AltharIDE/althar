import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * State a parent may drive: controlled when `value` is given, otherwise kept
 * here from `initial`. `onChange` hears every change either way. The setter
 * is stable. `null` is a value: pass it to control "nothing chosen".
 */
export function useControlled<T>(value: T | undefined, initial: T, onChange?: (next: T) => void): [T, (next: T) => void] {
  const [own, setOwn] = useState(initial)
  const controlled = value !== undefined
  const wasControlled = useRef(controlled)
  useEffect(() => {
    if (!import.meta.env.DEV || wasControlled.current === controlled) return
    console.warn(
      `A component changed from ${wasControlled.current ? 'controlled' : 'uncontrolled'} to ${controlled ? 'controlled' : 'uncontrolled'}. Decide once.`,
    )
    wasControlled.current = controlled
  }, [controlled])
  /* what the setter reads when it is called, kept current after each render */
  const latest = useRef({ controlled, onChange })
  useLayoutEffect(() => {
    latest.current = { controlled, onChange }
  })
  const set = useCallback((next: T) => {
    if (!latest.current.controlled) setOwn(next)
    latest.current.onChange?.(next)
  }, [])
  return [controlled ? value : own, set]
}
