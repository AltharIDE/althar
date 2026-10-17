// Scrappy: the project's front page, the kit's own; in A to D, with the bar's Settings on, the direction's Settings cover its whole window.
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ProjectFront as Real, type ProjectFrontProps, type WorkNeed } from '../../../src/index'
import { A } from '../directions/A'
import { B } from '../directions/B'
import { C } from '../directions/C'
import { D } from '../directions/D'
import { type Things, useThings } from '../parts'
import { type Direction, useProto } from '../state'

/** Under the project's header, as Home, Conversation and Board are: the views give way, the header stays, so it reads as the project's. */
function Cover({ children }: { children: ReactNode }) {
  const mark = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState<{ window: HTMLElement; top: number } | null>(null)
  useLayoutEffect(() => {
    const window = mark.current?.parentElement
    const front = mark.current?.previousElementSibling
    if (window == null || !(front instanceof HTMLElement)) return
    window.style.position = 'relative'
    const measure = () => setPlace({ window, top: front.offsetTop + front.offsetHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(front)
    return () => watch.disconnect()
  }, [])
  return (
    <>
      <span ref={mark} hidden />
      {place !== null &&
        createPortal(<div style={{ position: 'absolute', inset: `${place.top}px 0 0 0`, zIndex: 3 }}>{children}</div>, place.window)}
    </>
  )
}

function Settings({ direction, things }: { direction: Direction; things: Things }) {
  switch (direction) {
    case 'A':
      return <A things={things} />
    case 'B':
      return <B things={things} />
    case 'C':
      return <C things={things} />
    default:
      return <D things={things} />
  }
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
  const { settings: _, ...rest } = props
  return (
    <>
      <Real
        {...rest}
        parts={parts}
        yours={yours}
        needs={[...troubles, ...(props.needs ?? [])]}
        {...(props.onYours === undefined || (props.yours ?? 0) > 0 ? {} : { onYours: () => troubles[0]?.onOpen() })}
      />
      {p.showing !== 'closed' && (
        <Cover>
          <Settings direction={p.direction} things={things} />
        </Cover>
      )}
    </>
  )
}
