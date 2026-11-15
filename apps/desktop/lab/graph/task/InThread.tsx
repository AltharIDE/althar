import { type ComponentProps, type ReactNode, useState } from 'react'

import { AltharLine, KeyValues, LinkButton, Popover } from '@althar/ui'

import { Mark } from '../graph/parts'
import { word } from '../plan'
import { move } from '../state'
import type { NodeView } from '../view'
import { Lead, Notes } from './Brief'
import { MissionMap } from './MissionMap'
import { goTo, isLast, nextWords, type Place, standWords, usePlace } from './mission'
import s from './InThread.module.css'

/*
 * B · In the conversation. The task's thread opens with what the plan gave
 * it, where an issue's card heads a task that came from one: the mission
 * and which step, what this step does and why, the person's notes pinned,
 * what it builds on, and who leads it. Althar says in the thread when the
 * mission started it (thread.ts), and the thread ends with what merging it
 * starts, kept current. Where what it waits for failed, what to do about
 * it is beside it in the card.
 */

/** A neighbour by name, its mark before it, and where it stands unless merged: a press goes to it. One that failed has what to do beside it. */
function Neighbour({ node, of }: { node: NodeView; of: NodeView }) {
  return (
    <span className={s.neighbour}>
      <Mark stand={node.stand} />
      <LinkButton className={s.link} onClick={() => goTo(node)}>
        {node.spec.short}
      </LinkButton>
      {node.stand !== 'done' && <span className={s.said}>{standWords(node)}</span>}
      {node.stand === 'failed' && of.stand === 'stuck' && (
        <span className={s.acts}>
          <LinkButton onClick={() => move({ kind: 'retry', key: node.key })}>Try it again</LinkButton>
          <LinkButton onClick={() => move({ kind: 'unlink', key: of.key, dep: node.key })}>Start this without it</LinkButton>
        </span>
      )}
    </span>
  )
}

/** The mission's name, which opens it drawn small. */
function MissionName({ place, ...rest }: { place: Place } & ComponentProps<'button'>) {
  return (
    <button type="button" {...rest} className={s.mission}>
      {place.graph.scenario.name}
    </button>
  )
}

/** The card heading the thread: the plan's word for this step. */
export function Opening({ slug }: { slug: string }) {
  const place = usePlace(slug)
  const [open, setOpen] = useState(false)
  if (place === null) return null
  const { node, graph, before } = place
  const facts: Array<[string, ReactNode]> = []
  if (before.length > 0)
    facts.push([
      'After',
      <span key="after" className={s.neighbours}>
        {before.map((one) => (
          <Neighbour key={one.key} node={one} of={node} />
        ))}
      </span>,
    ])
  facts.push(['Lead', <Lead key="lead" node={node} className={s.lead} />])
  return (
    <section className={s.card} aria-label={`${graph.scenario.name}, step ${place.n} of ${place.of}`}>
      <p className={s.top}>
        <Popover
          trigger={<MissionName place={place} />}
          label={graph.scenario.name}
          placement="below"
          align="start"
          width={180 + 3 * 136}
          open={open}
          onOpenChange={setOpen}
          initialFocus="panel"
        >
          <div className={s.mapRoom}>
            <MissionMap place={place} />
          </div>
        </Popover>
        <span className={s.step}>
          {word()} · step {place.n} of {place.of}
        </span>
        <span className={s.merged}>
          {graph.merged} of {graph.nodes.length} merged
        </span>
      </p>
      <p className={s.what}>{node.spec.what}</p>
      <p className={s.why}>{node.spec.why}</p>
      <Notes node={node} className={s.notes} />
      <KeyValues keyWidth={56} items={facts} className={s.facts} />
    </section>
  )
}

/** A sentence with each task it names a press away. */
const linked = (sentence: string, nodes: ReadonlyArray<NodeView>): ReactNode[] => {
  const byName = new Map(nodes.map((one) => [one.spec.short, one]))
  const names = [...byName.keys()].toSorted((a, b) => b.length - a.length).map((one) => one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return sentence.split(new RegExp(`(${names.join('|')})`)).map((part, i) => {
    const node = byName.get(part)
    return node === undefined ? (
      part
    ) : (
      <LinkButton key={`${part}${i}`} onClick={() => goTo(node)}>
        {part}
      </LinkButton>
    )
  })
}

/** The thread's last word on the mission: what merging this starts, kept current. */
export function Closing({ slug }: { slug: string }) {
  const place = usePlace(slug)
  if (place === null) return null
  const { node, graph } = place
  const next = nextWords(place)
  if (next !== null) return <AltharLine>{linked(next, graph.nodes)}</AltharLine>
  // Nothing waits for it: the last of the mission, merging it finishes it; otherwise there's nothing to say.
  if (!isLast(place)) return null
  return (
    <AltharLine>{node.stand === 'done' ? `${graph.scenario.name} is done.` : `Merging this finishes ${graph.scenario.name}.`}</AltharLine>
  )
}
