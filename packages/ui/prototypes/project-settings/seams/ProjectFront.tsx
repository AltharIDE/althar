// Scrappy: the project's front page, the kit's own, with what the direction does around it.
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ProjectFront as Real, type ProjectFrontProps, type WorkNeed } from '../../../src/index'
import { B } from '../directions/B'
import { C } from '../directions/C'
import { Access, DFront } from '../directions/D'
import { useThings } from '../parts'
import css from '../parts.module.css'
import { proto, useProto } from '../state'

/** What covers the screen under the front page, in its window: B's view, C's sheet. */
function Under({ children, cover }: { children: React.ReactNode; cover: boolean }) {
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
          <div className={cover ? css.cover : css.beside} style={{ top: place.top } as CSSProperties}>
            {children}
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
      {...(p.direction === 'E' || p.direction === 'B' ? { settings: undefined } : {})}
      {...(p.direction === 'D'
        ? {
            run: (
              <>
                <Access things={things} />
                {props.run}
              </>
            ),
          }
        : {})}
    />
  )
  if (p.direction === 'D') return <DFront things={things}>{front}</DFront>
  if (p.direction === 'B' && p.showing !== 'closed')
    return (
      <>
        {front}
        <Under cover>
          <B key={p.showing} things={things} />
        </Under>
      </>
    )
  if (p.direction === 'C' && p.showing !== 'closed')
    return (
      <>
        {front}
        <Under cover={false}>
          <C things={things} onClose={() => proto.set({ showing: 'closed' })} />
        </Under>
      </>
    )
  return front
}
