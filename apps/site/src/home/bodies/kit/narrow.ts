import { useEffect, useState } from 'react'

/** Whether the window is a phone's width: what the pictures lay out narrower for. */
export function useNarrow(width = 700) {
  const query = `(max-width: ${width}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const q = window.matchMedia(query)
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [query])
  return narrow
}
