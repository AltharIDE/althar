import { useState } from 'react'

import { Button, Dialog, Icon, LinkButton } from '@althar/ui'

import { BUTTON_STOPS, HIDEABLE, ICON_OF, type Route, type Stop, commits, guideOf, same, setOnto as set, stopsOf, useOnto } from './onto'
import s from './lab.module.css'

/*
 * How Ship works: a friendly modal, each stop a step on a path in plain words for this route. A click on a stop's icon
 * turns it on or off for this Ship, the button behind following; once the route changes, the modal ends on the press
 * that route makes, named for what it does. Opened by Ship's first press, it ends on that press from the start.
 */

/** A stop turned on or off, the route kept whole: Push always goes, and Merge needs Ready. */
const toggled = (route: Route, stop: Stop, on: boolean): Route => {
  switch (stop) {
    case 'Review':
      return { ...route, review: on }
    case 'Push':
      return route
    case 'Ready':
      return { ...route, far: on ? 'ready' : 'push' }
    case 'Merge':
      return { ...route, far: on ? 'merge' : 'ready' }
  }
}

/** What pressing Ship does on this route, as the modal's own button says it. */
const doesOf = ({ review, far }: Route, n: number) =>
  review
    ? { push: 'Review, then push', ready: 'Review, then mark ready', merge: 'Review, then merge' }[far]
    : { push: `Push ${commits(n)}`, ready: 'Push and mark ready', merge: 'Push and merge' }[far]

export function ShipGuide({ route, n }: { route: Route; n: number }) {
  const now = useOnto()
  const [opened] = useState(route)
  const stops = stopsOf(route)
  const changed = !same(route, opened)
  const close = () => set({ modal: false, pressed: false })
  const ship = (
    <Button variant="signal" onClick={close}>
      {doesOf(route, n)}
    </Button>
  )
  return (
    <Dialog
      title="How Ship works"
      description={
        <>
          Ship takes your work toward main, one stop at a time, and stops wherever you’re needed. Click a stop’s icon to skip it this time.
        </>
      }
      width={480}
      tall
      onClose={close}
      actions={
        <>
          {HIDEABLE.has(now.entry) && !now.pressed && (
            <Button variant="quiet" className={s.actionsStart} onClick={() => set({ modal: false, hidden: true })}>
              Hide this link
            </Button>
          )}
          {now.pressed ? (
            <>
              <Button onClick={close}>Not now</Button>
              {ship}
            </>
          ) : changed ? (
            <>
              <Button onClick={close}>Close</Button>
              {ship}
            </>
          ) : (
            <Button variant="signal" onClick={close}>
              Got it
            </Button>
          )}
        </>
      }
    >
      <ol className={s.guide}>
        {BUTTON_STOPS.map((stop) => {
          const on = stops.includes(stop)
          return (
            <li key={stop} className={s.guideStop} data-skipped={!on || undefined}>
              {stop === 'Push' ? (
                <span className={s.guideIcon} title="Push always goes: it’s what Ship is for">
                  <Icon name={ICON_OF[stop]} size={14} />
                </span>
              ) : (
                <button
                  type="button"
                  className={s.guideIcon}
                  aria-pressed={on}
                  aria-label={on ? `Skip ${stop} this time` : `Bring ${stop} back`}
                  title={on ? `Skip ${stop} this time` : `Bring ${stop} back`}
                  onClick={() => set({ chosen: toggled(route, stop, !on) })}
                >
                  <Icon name={ICON_OF[stop]} size={14} />
                </button>
              )}
              <span className={s.guideText}>
                <b>
                  {stop}
                  {!on && <span className={s.guideOff}>Off</span>}
                </b>
                <span>{guideOf(stop, route, n, now.shared)}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {now.chosen !== null && !same(route, now.mine) && (
        <p className={s.whose}>
          <span>For this Ship only.</span>
          <LinkButton onClick={() => set({ mine: route, chosen: null })}>Make it my default</LinkButton>
        </p>
      )}
      {now.pressed && <p className={s.whose}>Only on your first Ship. After this, Ship goes at once.</p>}
    </Dialog>
  )
}
