import { type ComponentProps, useEffect, useState } from 'react'

import { Icon, Popover, Tooltip } from '@althar/ui'

import { Mark } from '../graph/parts'
import { word } from '../plan'
import { narrow, useStore } from '../state'
import type { NodeView } from '../view'
import { Brief } from './Brief'
import { goTo, loudestFirst, type Place, standWords, usePlace } from './mission'
import s from './Path.module.css'

/*
 * D · Neighbours as a path. A slim line under the header walks the mission
 * a task at a time: what this one waits for on the left, what waits for it
 * on the right, each with where it stands, [ and ] to step there. Between
 * them the mission, each of its tasks a bead in the plan's order, this one
 * ringed, any of them a press away; and the step's number, which opens what
 * the plan gave it.
 */

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]') !== null)

/** The neighbour [ or ] steps to: the one that says the most. */
const firstOf = (nodes: ReadonlyArray<NodeView>) => loudestFirst(nodes)[0]

/** A neighbour on the path: its mark and its name, a press away. */
function Step({ node, side, kbd }: { node: NodeView; side: 'before' | 'after'; kbd?: string }) {
  return (
    <Tooltip
      label={`${node.spec.title}: ${standWords(node)}`}
      {...(kbd === undefined ? {} : { kbd })}
      placement="below"
      align={side === 'before' ? 'start' : 'end'}
    >
      <button type="button" className={[s.step, s[side]].join(' ')} onClick={() => goTo(node)} aria-label={node.spec.title}>
        <Mark stand={node.stand} />
        <span className={s.name}>{node.spec.short}</span>
      </button>
    </Tooltip>
  )
}

/** The step's number, which opens what the plan gave it. */
function StepNumber({ place, ...rest }: { place: Place } & ComponentProps<'button'>) {
  const notes = place.node.spec.notes ?? []
  return (
    <button type="button" {...rest} className={s.number}>
      Step {place.n} of {place.of}
      {notes.length > 0 && <Icon name="pin" size={11} className={s.pin} />}
    </button>
  )
}

export function Path({ slug }: { slug: string }) {
  const place = usePlace(slug)
  const small = useStore(narrow)
  const [open, setOpen] = useState(false)
  const back = place === null ? undefined : firstOf(place.before)
  const on = place === null ? undefined : firstOf(place.after)
  // [ steps back along the path, ] on.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const to = event.key === '[' ? back : event.key === ']' ? on : undefined
      if (to === undefined) return
      event.preventDefault()
      goTo(to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, on])
  if (place === null) return null
  const { graph, node } = place
  // In the narrow window, a side with more than one neighbour shows the one that says the most, and how many more; the beads reach the rest.
  const shown = (nodes: ReadonlyArray<NodeView>) => (small ? loudestFirst(nodes).slice(0, 1) : nodes)
  const more = (nodes: ReadonlyArray<NodeView>) =>
    nodes.length > shown(nodes).length && <span className={s.more}>+{nodes.length - shown(nodes).length}</span>
  return (
    <nav className={s.path} aria-label={`${graph.scenario.name}, step ${place.n} of ${place.of}`}>
      <div className={s.before}>
        {place.before.length > 0 && <Icon name="arrow" size={12} className={s.back} />}
        {shown(place.before).map((one) => (
          <Step key={one.key} node={one} side="before" {...(one === back ? { kbd: '[' } : {})} />
        ))}
        {more(place.before)}
      </div>
      <div className={s.mission}>
        <span className={s.missionName}>{graph.scenario.name}</span>
        <ol className={s.beads} aria-label={`${word()}: ${graph.merged} of ${graph.nodes.length} merged`}>
          {graph.nodes.map((one) => (
            <li key={one.key}>
              <Tooltip label={`${one.spec.title}: ${standWords(one)}`} placement="below" align="center">
                <button
                  type="button"
                  className={[s.bead, one.key === node.key && s.here].filter(Boolean).join(' ')}
                  aria-current={one.key === node.key ? 'page' : undefined}
                  aria-label={one.spec.title}
                  onClick={() => one.key !== node.key && goTo(one)}
                >
                  <Mark stand={one.stand} />
                </button>
              </Tooltip>
            </li>
          ))}
        </ol>
        <Popover
          trigger={<StepNumber place={place} />}
          label={`Step ${place.n}: ${node.spec.short}`}
          placement="below"
          align="center"
          width={360}
          open={open}
          onOpenChange={setOpen}
          initialFocus="panel"
        >
          <Brief node={node} />
        </Popover>
      </div>
      <div className={s.after}>
        {more(place.after)}
        {shown(place.after).map((one) => (
          <Step key={one.key} node={one} side="after" {...(one === on ? { kbd: ']' } : {})} />
        ))}
        {place.after.length > 0 && <Icon name="arrow" size={12} className={s.on} />}
      </div>
    </nav>
  )
}
