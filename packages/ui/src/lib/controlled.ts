import { useState } from 'react'

/**
 * State a parent may drive: controlled when `value` is given, otherwise kept
 * here from `initial`. `onChange` hears every change either way.
 */
export function useControlled<T>(value: T | undefined, initial: T, onChange?: (next: T) => void): [T, (next: T) => void] {
  const [own, setOwn] = useState(initial)
  const current = value === undefined ? own : value
  const set = (next: T) => {
    if (value === undefined) setOwn(next)
    onChange?.(next)
  }
  return [current, set]
}
