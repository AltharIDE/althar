import { useEffect, useState } from 'react'

/** The id of the section crossing the middle of the viewport, of those given. */
export function useCurrent(ids: readonly string[]): string {
  const [on, setOn] = useState(ids[0] ?? '')
  const key = ids.join(' ')
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setOn(e.target.id)
      },
      { rootMargin: '-40% 0px -55% 0px' },
    )
    for (const id of key.split(' ')) {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [key])
  return on
}
