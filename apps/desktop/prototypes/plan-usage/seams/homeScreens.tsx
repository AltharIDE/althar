// Scrappy: the kit's screens as the home (HomeView) sees them. In C, the home ends with a quiet plan usage section, under what needs you, or under the words of a home at rest: the kit's Home has no slot for it, so it goes into the home's own column from outside, and follows it as the home changes between the two.
import { Home as KitHome, type HomeProps } from '@althar/ui/screens'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { HomeUsage } from '../parts/HomeUsage'
import { useProto } from '../store'

export * from '@althar/ui/screens'

export function Home(props: HomeProps) {
  const { d } = useProto()
  const ref = useRef<HTMLDivElement>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (d !== 'C') return
    const stream = ref.current?.querySelector('main')
    if (stream == null) return
    const made = document.createElement('div')
    // The busy home's column, or the resting home's words; last in it, whatever it draws after.
    const place = () => {
      const column = stream.querySelector('[class*="__column__"]') ?? stream.querySelector('[class*="__words__"]') ?? stream
      if (column.lastElementChild !== made) column.appendChild(made)
    }
    place()
    const watch = new MutationObserver(place)
    watch.observe(stream, { childList: true, subtree: true })
    setSlot(made)
    return () => {
      watch.disconnect()
      made.remove()
      setSlot(null)
    }
  }, [d])
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      <KitHome {...props} />
      {d === 'C' && slot !== null && createPortal(<HomeUsage />, slot)}
    </div>
  )
}
