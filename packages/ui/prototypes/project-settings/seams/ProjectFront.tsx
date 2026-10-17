// Scrappy: the project's front page, the kit's own, with what the direction puts under it.
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ProjectFront as Real, type ProjectFrontProps, type WorkNeed } from '../../../src/index'
import { F } from '../directions/F'
import { I } from '../directions/I'
import { useThings } from '../parts'
import { proto, useProto } from '../state'

/** What sits over the screen under the front page, in its window, from the header down: F's column, I's unfolded header. */
function Under({ children }: { children: React.ReactNode }) {
  const mark = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState<{ window: HTMLElement; top: number } | null>(null)
  useLayoutEffect(() => {
    const window = mark.current?.parentElement
    const front = mark.current?.previousElementSibling
    if (window == null || front == null) return
    window.style.position = 'relative'
    const measure = () => setPlace({ window, top: (front as HTMLElement).offsetHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(front)
    return () => watch.disconnect()
  }, [])
  return (
    <>
      <span ref={mark} hidden />
      {place !== null &&
        createPortal(
          <div style={{ position: 'absolute', inset: `${place.top}px 0 0 0`, zIndex: 3, pointerEvents: 'none' } as CSSProperties}>
            <div style={{ pointerEvents: 'auto' }}>{children}</div>
          </div>,
          place.window,
        )}
    </>
  )
}

export function ProjectFront(props: ProjectFrontProps) {
  const p = useProto()
  const things = useThings()
  if (p.direction === 'Today') return <Real {...props} />
  // A connection that needs the person is one more thing that needs them, as on every screen.
  const troubles: WorkNeed[] = [things.host, ...things.trackers].flatMap((link) =>
    link === null || link.trouble === null
      ? []
      : [
          {
            id: `connect-${link.product}`,
            kind: link.trouble === 'signed-out' ? 'Signed out' : 'Not connected',
            title: link.trouble === 'signed-out' ? `Sign in to ${link.name} again` : `Connect ${link.name}`,
            meta: link.trouble === 'signed-out' ? 'Its tasks can’t push or open pull requests' : `${link.what} don’t move with their tasks`,
            onOpen: () => things.connect(link),
          },
        ],
  )
  const yours = (props.yours ?? 0) + troubles.length
  // Its trackers as the project names them, not only as its tasks' issues do: added or taken out, the front follows.
  const parts = [
    ...(props.parts ?? []).filter((part) => !part.id.startsWith('tracker:')),
    ...things.trackers.map((link) => ({
      id: `tracker:${link.id}`,
      name: link.what,
      brand: link.brand,
      ...(link.url === null ? {} : { openLabel: `Open on ${link.name}`, onOpen: () => window.open(link.url ?? '', '_blank') }),
    })),
  ]
  const front = (
    <Real
      {...props}
      parts={parts}
      yours={yours}
      needs={[...troubles, ...(props.needs ?? [])]}
      {...(props.onYours === undefined || (props.yours ?? 0) > 0 ? {} : { onYours: () => troubles[0]?.onOpen() })}
      {...(p.direction === 'J' ? { settings: undefined } : {})}
    />
  )
  const open = p.showing !== 'closed'
  if (open && (p.direction === 'F' || p.direction === 'I'))
    return (
      <>
        {front}
        <Under>
          {p.direction === 'F' ? (
            <F key={p.showing} things={things} onClose={() => proto.set({ showing: 'closed' })} />
          ) : (
            <I things={things} />
          )}
        </Under>
      </>
    )
  return front
}
