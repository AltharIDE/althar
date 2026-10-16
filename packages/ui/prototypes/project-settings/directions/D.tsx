// D · Settings in place: each is changed where the front page shows it. The name and mark change their name and colour; a repository or tracker says who Althar is there; access has a word of its own beside Run; a small menu keeps the rest.
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { Button, ControlSheet, IconButton, LinkButton, Popover } from '../../../src/index'
import {
  AllowEverything,
  Conflicts,
  Identity,
  LinkRow,
  MoveIssues,
  Notes,
  NotesRow,
  overlay,
  RulesRow,
  RunsRow,
  SettingList,
  type Things,
  WhereRows,
} from '../parts'
import css from '../parts.module.css'
import { useProto } from '../state'

interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const boxOf = (element: Element, frame: DOMRect, pad = 0): Box => {
  const r = element.getBoundingClientRect()
  return { left: r.left - frame.left - pad, top: r.top - frame.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
}

const union = (a: Box, b: Box): Box => {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  }
}

/** A place on the front that opens what it shows: over the words themselves, so they read as they do. */
function InPlace({
  box,
  label,
  yours,
  width = 400,
  children,
}: {
  box: Box
  label: string
  yours?: boolean
  width?: number
  children: ReactNode
}) {
  return (
    <Popover
      trigger={
        <button
          type="button"
          aria-label={label}
          title={label}
          className={css.anchor}
          data-yours={yours === true ? '' : undefined}
          style={box as CSSProperties}
        />
      }
      label={label}
      align="start"
      width={width}
      initialFocus="panel"
    >
      <div className={css.pop}>{children}</div>
    </Popover>
  )
}

/** The front page as it is, with its name, mark and parts opening in place. */
export function DFront({ things, children }: { things: Things; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<{ name: Box | null; parts: Box[] }>({ name: null, parts: [] })
  useLayoutEffect(() => {
    const element = frame.current
    if (element === null) return
    const measure = () => {
      const at = element.getBoundingClientRect()
      const header = element.querySelector('header')
      const heading = header?.querySelector('h1')
      const mark = header?.firstElementChild
      const name = heading == null || mark == null ? null : union(boxOf(mark, at, 2), boxOf(heading, at, 4))
      const parts = [...element.querySelectorAll('header ul > li')].map((li) => boxOf(li, at, 3))
      setBoxes({ name, parts })
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [things.tracker, things.name])
  const [repo, tracker] = boxes.parts
  return (
    <div ref={frame} className={css.inPlace}>
      {children}
      {boxes.name !== null && (
        <InPlace box={boxes.name} label="Change its name and colour" width={380}>
          <Identity things={things} />
        </InPlace>
      )}
      {repo !== undefined && things.host !== null && (
        <InPlace box={repo} label={`${things.host.name}: ${things.host.what}`} yours={things.host.trouble !== null}>
          <SettingList>
            <LinkRow link={things.host} things={things} />
            <WhereRows things={things} />
          </SettingList>
          <div className={css.row}>
            <LinkButton onClick={() => window.open('https://github.com/AltharIDE/althar', '_blank')}>Open on GitHub</LinkButton>
            <LinkButton onClick={things.openRepositories}>Add or change repositories</LinkButton>
          </div>
        </InPlace>
      )}
      {tracker !== undefined && things.tracker !== null && (
        <InPlace box={tracker} label={`${things.tracker.name}: ${things.tracker.what}`} yours={things.tracker.trouble !== null}>
          <SettingList>
            <LinkRow link={things.tracker} things={things} />
            <MoveIssues things={things} />
          </SettingList>
          <div className={css.row}>
            <LinkButton onClick={() => window.open('https://linear.app/charrette/team/DEV', '_blank')}>Open on Linear</LinkButton>
          </div>
        </InPlace>
      )}
    </div>
  )
}

/** Access, beside Run: what agents may do, in a word, opening the switches and the way to the rules. */
export function Access({ things }: { things: Things }) {
  const rules = things.rules
  if (rules === null || things.policy === null) return null
  return (
    <Popover
      trigger={
        <Button size="small" variant="quiet" icon="lock">
          {rules.allowEverything ? 'Everything allowed' : things.policy.policy}
        </Button>
      }
      label="Access"
      align="end"
      width={420}
      initialFocus="panel"
    >
      <div className={css.pop}>
        <SettingList>
          <AllowEverything things={things} />
          <Conflicts things={things} />
          <RulesRow things={things} />
        </SettingList>
      </div>
    </Popover>
  )
}

/** What has no place on the front: what it runs, its notes, removing it. */
export function DMore({ things }: { things: Things }) {
  const p = useProto()
  const [open, setOpen] = useState(p.showing !== 'closed')
  // Opened as the picker says: the page keys it by that, so it starts again when it changes.
  const [notes, setNotes] = useState(p.showing === 'notes')
  return (
    <Popover
      trigger={<IconButton icon="more" label={`More of ${things.name}`} size="small" />}
      label={`More of ${things.name}`}
      align="end"
      width={420}
      initialFocus="panel"
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setNotes(false)
      }}
    >
      <div className={css.pop}>
        {notes ? (
          <>
            <div className={css.row}>
              <LinkButton onClick={() => setNotes(false)}>← More of {things.name}</LinkButton>
            </div>
            <ControlSheet>
              <Notes things={things} />
            </ControlSheet>
          </>
        ) : (
          <>
            <SettingList>
              <RunsRow things={things} />
              <NotesRow things={things} onOpen={() => setNotes(true)} />
            </SettingList>
            <div className={css.row}>
              <LinkButton onClick={() => overlay.set({ removing: true })}>Remove from Althar…</LinkButton>
            </div>
          </>
        )}
      </div>
    </Popover>
  )
}
