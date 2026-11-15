import { type ReactNode, useState } from 'react'

import { Button, Choices, Dialog, Icon, LinkButton, Switch } from '@althar/ui'

import { BUTTON_STOPS, ICON_OF, type Route, commits, guideOf, same, saysOf, setOnto as set, stopWords, stopsOf, useOnto } from './onto'
import s from './lab.module.css'

/*
 * Variants of the friendly modal Ship's quiet link opens (M cycles them). Every
 * one says the same stops in the same words; the ones you edit in set this
 * Ship's route as you read, the button behind following, and end on the press
 * the route makes, named for what it does.
 */

type Stop = (typeof BUTTON_STOPS)[number]

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

const close = () => set({ modal: false })
const hide = (
  <Button variant="quiet" className={s.actionsStart} onClick={() => set({ modal: false, hidden: true })}>
    Hide this link
  </Button>
)

/** Whose route this is: their default (and why Althar bent it, where it did), or this Ship's, with a way to keep it. */
function Whose({ route }: { route: Route }) {
  const now = useOnto()
  const fromDefault = now.chosen === null || same(route, now.mine)
  return (
    <p className={s.whose}>
      {fromDefault ? (
        <>
          <Icon name="check" size={12} className={s.whoseTick} />
          <span>
            {now.chosen === null && !same(route, now.mine)
              ? 'Your default, stopping at Ready: main here needs someone else’s approval.'
              : 'Your default.'}
          </span>
        </>
      ) : (
        <>
          <span>For this Ship only.</span>
          <LinkButton onClick={() => set({ mine: route, chosen: null })}>Make it my default</LinkButton>
        </>
      )}
    </p>
  )
}

/** The modal's end where you edit in it: hide its link, close keeping the route, or Ship, named for what it does. */
const editActions = (route: Route, n: number) => (
  <>
    {hide}
    <Button onClick={close}>Close</Button>
    <Button variant="signal" onClick={() => set({ modal: false, explained: true })}>
      {doesOf(route, n)}
    </Button>
  </>
)

/** The stops across, an icon each on one line, and under each a word on what it does; the editable one turns them on and off. */
function Across({ route, n, editable }: { route: Route; n: number; editable: boolean }) {
  const now = useOnto()
  const stops = stopsOf(route)
  return (
    <div className={s.across}>
      {BUTTON_STOPS.map((stop) => {
        const on = stops.includes(stop)
        const words = stopWords(stop, route, n, now.shared)
        const locked = stop === 'Push'
        const inner = (
          <>
            <span className={s.acrossDot}>
              <Icon name={ICON_OF[stop]} size={16} />
            </span>
            <b>{stop}</b>
            <small>{locked && editable ? 'Always' : words.short}</small>
          </>
        )
        return editable && !locked ? (
          <button
            type="button"
            key={stop}
            className={s.acrossStop}
            aria-pressed={on}
            data-on={on || undefined}
            onClick={() => set({ chosen: toggled(route, stop, !on) })}
          >
            {inner}
          </button>
        ) : (
          <span key={stop} className={s.acrossStop} data-on={on || undefined} data-locked={(editable && locked) || undefined}>
            {inner}
          </span>
        )
      })}
    </div>
  )
}

/**
 * A switch a stop: the path you read, each stop turned on or off where it stands. With `toggle`, the path reads as it
 * is, Got it at its end, until Change stops brings the switches in and turns Got it into the press the route makes.
 */
function Switches({ route, n, toggle = false }: { route: Route; n: number; toggle?: boolean }) {
  const now = useOnto()
  const stops = stopsOf(route)
  const [changing, setChanging] = useState(!toggle || new URLSearchParams(location.search).get('changing') === '1')
  return (
    <Dialog
      title="How Ship works"
      description={
        toggle
          ? 'Ship takes your work toward main, one stop at a time, and stops wherever you’re needed.'
          : 'Ship takes your work toward main, one stop at a time. Turn any stop off for this Ship.'
      }
      width={500}
      tall
      onClose={close}
      actions={
        changing ? (
          editActions(route, n)
        ) : (
          <>
            {hide}
            <Button variant="signal" onClick={close}>
              Got it
            </Button>
          </>
        )
      }
    >
      {toggle && (
        <span className={s.changeStops}>
          <span aria-hidden="true">Change stops</span>
          <Switch checked={changing} onChange={setChanging} label="Change stops" />
        </span>
      )}
      <ol className={s.guide}>
        {BUTTON_STOPS.map((stop) => {
          const on = stops.includes(stop)
          return (
            <li key={stop} className={`${s.guideStop} ${s.guideEdit}`} data-skipped={!on || undefined}>
              <span className={s.guideIcon}>
                <Icon name={ICON_OF[stop]} size={14} />
              </span>
              <span className={s.guideText}>
                <b>
                  {stop}
                  {!on && !changing && <span className={s.guideOff}>Off</span>}
                </b>
                <span>{guideOf(stop, route, n, now.shared)}</span>
              </span>
              {!changing ? (
                <span />
              ) : stop === 'Push' ? (
                <span className={s.always}>Always</span>
              ) : (
                <Switch checked={on} onChange={(next) => set({ chosen: toggled(route, stop, next) })} label={stop} />
              )}
            </li>
          )
        })}
      </ol>
      {changing && <Whose route={route} />}
    </Dialog>
  )
}

/** Tap the route: the stops across, each a press that turns it on or off, and the whole route said under them. */
function Tap({ route, n }: { route: Route; n: number }) {
  return (
    <Dialog
      title="How Ship works"
      description="Ship takes your work toward main, one stop at a time. Tap a stop to skip it this time."
      width={520}
      onClose={close}
      actions={editActions(route, n)}
    >
      <Across route={route} n={n} editable />
      <p className={s.says}>
        <b>Ship</b> {saysOf(route, n)}.
      </p>
      <Whose route={route} />
    </Dialog>
  )
}

const keyOf = ({ review, far }: Route) => `${review ? 'review' : 'push'}-${far}` as const
type RouteKey = ReturnType<typeof keyOf>

/** Pick a route: the few that people take, by name, instead of stop by stop. */
function Pick({ route, n }: { route: Route; n: number }) {
  const now = useOnto()
  const picks: ReadonlyArray<{ route: Route; title: string; note: string }> = [
    {
      route: { review: true, far: 'merge' },
      title: 'Review, then merge',
      note: 'All the way: GPT-6.1 Sol reads them, and PR #820 merges once verify passes.',
    },
    {
      route: { review: true, far: 'ready' },
      title: 'Review, then mark ready',
      note: 'Read, sent up, and ready for someone else to approve and merge.',
    },
    { route: { review: true, far: 'push' }, title: 'Review, then push', note: 'Read and sent up; PR #820 stays a draft.' },
    {
      route: { review: false, far: 'push' },
      title: `Push ${commits(n)}`,
      note: 'Straight up, unread, still a draft: when you only want them on GitHub.',
    },
    {
      route: { review: false, far: 'merge' },
      title: 'Push and merge',
      note: 'Unread, merged once verify passes: when you’re sure and it’s small.',
    },
  ]
  return (
    <Dialog
      title="How Ship works"
      description={`Ship takes your ${commits(n)} toward main, one stop at a time. Pick how far this Ship goes.`}
      width={480}
      tall
      onClose={close}
      actions={editActions(route, n)}
    >
      <Choices<RouteKey>
        label="How far this Ship goes"
        value={keyOf(route)}
        onChange={(key) => set({ chosen: picks.find((one) => keyOf(one.route) === key)!.route })}
        options={picks.map((one) => ({
          value: keyOf(one.route),
          title: same(one.route, now.mine) ? `${one.title} · your default` : one.title,
          note: one.note,
        }))}
      />
      <p className={s.whose}>
        <span>Any other mix of stops is in the arrow beside Ship.</span>
      </p>
      <Whose route={route} />
    </Dialog>
  )
}

/** A stop a page: one stop at a time, big, with its switch, the stops across the top to jump between them. */
function Tour({ route, n }: { route: Route; n: number }) {
  const now = useOnto()
  const stops = stopsOf(route)
  const page = Math.min(Math.max(now.page, 0), BUTTON_STOPS.length - 1)
  const stop = BUTTON_STOPS[page]!
  const on = stops.includes(stop)
  const last = page === BUTTON_STOPS.length - 1
  return (
    <Dialog
      title="How Ship works"
      description="Ship takes your work toward main, one stop at a time."
      width={460}
      onClose={close}
      actions={
        <>
          {hide}
          {page > 0 && <Button onClick={() => set({ page: page - 1 })}>Back</Button>}
          {last ? (
            <Button variant="signal" onClick={() => set({ modal: false, explained: true })}>
              {doesOf(route, n)}
            </Button>
          ) : (
            <Button variant="signal" onClick={() => set({ page: page + 1 })}>
              Next
            </Button>
          )}
        </>
      }
    >
      <nav className={s.tourStops} aria-label="Stops">
        {BUTTON_STOPS.map((one, i) => (
          <button
            key={one}
            type="button"
            aria-current={i === page ? 'step' : undefined}
            data-on={stops.includes(one) || undefined}
            onClick={() => set({ page: i })}
          >
            {one}
          </button>
        ))}
      </nav>
      <div className={s.tourPage} data-skipped={!on || undefined}>
        <span className={s.tourIcon}>
          <Icon name={ICON_OF[stop]} size={22} />
        </span>
        <b>{stop}</b>
        <p>{guideOf(stop, route, n, now.shared)}</p>
        {stop === 'Push' ? (
          <span className={s.always}>Always on: it’s what Ship is for.</span>
        ) : (
          <span className={s.tourSwitch}>
            <Switch checked={on} onChange={(next) => set({ chosen: toggled(route, stop, next) })} label={`${stop} on this Ship`} />
            <span>{on ? 'On for this Ship' : 'Skipped this Ship'}</span>
          </span>
        )}
      </div>
      {last && <Whose route={route} />}
    </Dialog>
  )
}

/** Short: the route across and in a sentence, the details a press away. */
function Short({ route, n }: { route: Route; n: number }) {
  const now = useOnto()
  const [more, setMore] = useState(false)
  return (
    <Dialog
      title="How Ship works"
      width={440}
      onClose={close}
      actions={
        <>
          {hide}
          <Button variant="signal" onClick={close}>
            Got it
          </Button>
        </>
      }
    >
      <Across route={route} n={n} editable={false} />
      <p className={s.says}>
        <b>Ship</b> {saysOf(route, n)}. The arrow beside it turns stops on and off.
      </p>
      {more ? (
        <ol className={s.shortMore}>
          {BUTTON_STOPS.map((stop) => (
            <li key={stop} data-skipped={!stopsOf(route).includes(stop) || undefined}>
              <b>{stop}</b> {guideOf(stop, route, n, now.shared)}
            </li>
          ))}
        </ol>
      ) : (
        <LinkButton onClick={() => setMore(true)}>What each stop does</LinkButton>
      )}
    </Dialog>
  )
}

/** The friendly modal as the lab's M has it; the path you only read stays in onto. */
export function GuideOf({ route, n }: { route: Route; n: number }): ReactNode {
  const now = useOnto()
  switch (now.guide) {
    case 'switches':
      return <Switches route={route} n={n} />
    case 'pathToggle':
      return <Switches route={route} n={n} toggle />
    case 'tap':
      return <Tap route={route} n={n} />
    case 'pick':
      return <Pick route={route} n={n} />
    case 'tour':
      return <Tour route={route} n={n} />
    case 'short':
      return <Short route={route} n={n} />
    case 'path':
      return null
  }
}
