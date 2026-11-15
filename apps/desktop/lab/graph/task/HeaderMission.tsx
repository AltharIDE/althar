import { type ComponentProps, Fragment, useState } from 'react'

import { Popover } from '@althar/ui'

import { Mark } from '../graph/parts'
import { word } from '../plan'
import { narrow, useStore } from '../state'
import type { NodeView } from '../view'
import { Brief } from './Brief'
import { MissionMap } from './MissionMap'
import { loudestFirst, type Place, usePlace } from './mission'
import s from './HeaderMission.module.css'

/*
 * A · In the header. Beside the task's title, which mission it is part of
 * and which step: its neighbours as a strip of marks (what it waits for,
 * this one, what waits for it), then the mission's name and the step's
 * number; in the narrow window, the strip alone. Pressing it opens the mission in place: this step as the plan
 * gave it, and the whole mission drawn small, this step ringed, each task a
 * press away.
 */

/** The neighbours on one side: their marks, close together, at most `most` of them; the rest are in the popover. */
function Side({ nodes, most }: { nodes: ReadonlyArray<NodeView>; most: number }) {
  if (nodes.length === 0) return null
  const shown = loudestFirst(nodes).slice(0, most)
  return (
    <span className={s.side}>
      {shown.map((one) => (
        <Mark key={one.key} stand={one.stand} />
      ))}
      {nodes.length > most && <span className={s.more}>+{nodes.length - most}</span>}
    </span>
  )
}

/** The trigger: the strip, then the mission and the step. It takes the popover's props and ref. */
function Trigger({ place, small, ...rest }: { place: Place; small: boolean } & ComponentProps<'button'>) {
  const parts = [place.before.length > 0 && 'before', 'here', place.after.length > 0 && 'after'].filter(Boolean)
  return (
    <button type="button" {...rest} className={s.trigger} aria-label={`${place.graph.scenario.name}, step ${place.n} of ${place.of}`}>
      <span className={s.strip} aria-hidden="true">
        {parts.map((part, i) => (
          <Fragment key={part as string}>
            {i > 0 && <i className={s.link} />}
            {part === 'before' ? (
              <Side nodes={place.before} most={small ? 1 : 3} />
            ) : part === 'after' ? (
              <Side nodes={place.after} most={small ? 1 : 3} />
            ) : (
              <span className={s.here} />
            )}
          </Fragment>
        ))}
      </span>
      {!small && (
        <>
          <span className={s.name}>{place.graph.scenario.name}</span>
          <span className={s.step}>
            step {place.n} of {place.of}
          </span>
        </>
      )}
    </button>
  )
}

export function HeaderMission({ slug }: { slug: string }) {
  const place = usePlace(slug)
  const small = useStore(narrow)
  const [open, setOpen] = useState(false)
  if (place === null) return null
  const { graph, node } = place
  return (
    <Popover
      trigger={<Trigger place={place} small={small} />}
      label={graph.scenario.name}
      placement="below"
      align="start"
      width={472}
      padded={false}
      open={open}
      onOpenChange={setOpen}
      initialFocus="panel"
    >
      <div className={s.pop}>
        <div className={s.head}>
          <span className={s.title}>{graph.scenario.name}</span>
          <span className={s.noun}>{word()}</span>
          <span className={[s.stands, s[graph.stand.tone]].join(' ')}>
            {graph.merged} of {graph.nodes.length} merged
          </span>
        </div>
        <section className={s.section} aria-label={`Step ${place.n}`}>
          <p className={s.eyebrow}>
            Step {place.n} · {node.spec.short}
          </p>
          <Brief node={node} />
        </section>
        <div className={s.mapRoom}>
          <MissionMap place={place} />
        </div>
      </div>
    </Popover>
  )
}
