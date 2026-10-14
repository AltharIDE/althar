import { Button, Kbd, Popover, Segmented, Switch } from '@althar/ui'
import { ToggleGroup } from 'radix-ui'
import { Component, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

import { leftAlone, step } from './keys'
import { problemsOf, type Prototype, type View } from './prototype'
import { SharedProvider, SharedValues } from './shared'
import { TODAY, fit, read, write, type Offered, type Shown } from './url'
import s from './Workbench.module.css'

/*
 * One page for a prototype: the direction shown fills it, and a slim bar at
 * the bottom switches between the directions, A, B, C…, and the states they
 * show, in place, so comparing never means leaving the page. What the person
 * did in a direction (useShared) stays as they switch. Side by side stands
 * the directions next to each other at the same state. The address follows
 * what is shown, so a link points at one exact view.
 */

/** What the bar names a direction by. */
interface Named {
  readonly key: string
  readonly name: string
}

/** How a script drives the page, as the screenshot helper does: what it offers, and showing one view of it. */
export interface WorkbenchHandle {
  readonly title: string
  readonly directions: readonly Named[]
  readonly states: readonly Named[]
  readonly shown: Shown
  /** Shows a view, resolving once it is drawn. */
  show(next: Partial<Shown>): Promise<void>
}

declare global {
  interface Window {
    __workbench?: WorkbenchHandle
  }
}

export interface WorkbenchProps<F> {
  prototype: Prototype<F>
}

/** The page has to have painted what was shown before a picture is taken of it. */
const painted = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))

export function Workbench<F>({ prototype }: WorkbenchProps<F>) {
  const { today, title, width } = prototype
  const directions = useMemo(
    () => [...(today === undefined ? [] : [{ key: TODAY, name: today.name ?? 'Today', render: today.render }]), ...prototype.directions],
    [today, prototype.directions],
  )
  const states = useMemo(() => prototype.states ?? [], [prototype.states])
  const offered = useMemo<Offered>(
    () => ({ directions: directions.map((direction) => direction.key), states: states.map((state) => state.key) }),
    [directions, states],
  )
  const [kept, setShown] = useState(() => read(window.location.search, offered))
  // Made to fit what the prototype offers now: a direction taken out while it is worked on gives way to the first.
  const shown = useMemo(() => fit(kept, offered), [kept, offered])
  const [values] = useState(() => new SharedValues())
  const fixtures = useMemo(() => prototype.fixtures?.(shown.state), [prototype, shown.state])
  const problems = problemsOf(prototype)

  // The address follows what is shown.
  useEffect(() => {
    const search = write(shown, offered, window.location.search)
    if (search !== window.location.search)
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
  }, [shown, offered])

  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (leftAlone(event)) return
      const next = step(shown, event.key, offered)
      if (next === null) return
      event.preventDefault()
      setShown(next)
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [shown, offered])

  const nameOf = (key: string) => directions.find((direction) => direction.key === key)?.name ?? key
  useEffect(() => {
    const what = shown.side === null ? nameOf(shown.direction) : 'Side by side'
    document.title = `${what} · ${title}`
  })

  useEffect(() => {
    window.__workbench = {
      title,
      directions: directions.map(({ key, name }) => ({ key, name })),
      states: states.map(({ key, name }) => ({ key, name })),
      shown,
      show: (next) => {
        flushSync(() => setShown((current) => ({ ...current, ...next })))
        return painted()
      },
    }
  }, [title, directions, states, shown])

  const drawn = (key: string) => {
    const direction = directions.find((one) => one.key === key)
    const view: View<F> = { direction: key, state: shown.state, fixtures: fixtures as F, side: shown.side !== null }
    return (
      <Guard name={nameOf(key)} reset={[shown.state, prototype]}>
        {direction !== undefined && <Drawn render={direction.render} view={view} />}
      </Guard>
    )
  }

  return (
    <SharedProvider values={values}>
      <div className={s.page}>
        <main className={s.stage} aria-label={shown.side === null ? nameOf(shown.direction) : 'Side by side'}>
          {problems.length > 0 ? (
            <Problems problems={problems} />
          ) : shown.side === null ? (
            <div key={shown.direction} className={s.alone}>
              {drawn(shown.direction)}
            </div>
          ) : (
            <div className={s.side} style={{ gridTemplateColumns: `repeat(${shown.side.length}, minmax(0, 1fr))` }}>
              {shown.side.map((key) => (
                <section key={key} className={s.pane} aria-label={nameOf(key)}>
                  <header className={s.caption}>
                    <Label direction={{ key, name: nameOf(key) }} />
                  </header>
                  <Fit width={width}>{drawn(key)}</Fit>
                </section>
              ))}
            </div>
          )}
        </main>
        {shown.bar ? (
          <Bar title={title} directions={directions} states={states} offered={offered} shown={shown} onShow={setShown} />
        ) : (
          <div className={s.peek}>
            <Button variant="quiet" size="small" kbd="H" onClick={() => setShown({ ...shown, bar: true })}>
              Show bar
            </Button>
          </div>
        )}
      </div>
    </SharedProvider>
  )
}

/** A direction, drawn as a component of its own, so its render function may use hooks. */
function Drawn<F>({ render, view }: { render: (view: View<F>) => ReactNode; view: View<F> }) {
  return render(view)
}

/** A direction as the bar and a pane's caption name it: its key, then its name; Today by its name alone. */
function Label({ direction }: { direction: Named }) {
  return direction.key === TODAY ? (
    <span className={s.name}>{direction.name}</span>
  ) : (
    // The space, which the flex layout doesn't draw, makes it read "A Quiet" rather than "AQuiet".
    <>
      <span className={s.letter}>{direction.key}</span> <span className={s.name}>{direction.name}</span>
    </>
  )
}

interface BarProps {
  title: string
  directions: readonly Named[]
  states: readonly Named[]
  offered: Offered
  shown: Shown
  onShow: (next: Shown) => void
}

function Bar({ title, directions, states, offered, shown, onShow }: BarProps) {
  const sideLabel = useId()
  const own = directions.filter((direction) => direction.key !== TODAY)
  const shortcut = (key: string) =>
    key === TODAY
      ? '0'
      : own.findIndex((direction) => direction.key === key) < 9
        ? String(own.findIndex((direction) => direction.key === key) + 1)
        : undefined
  const items = directions.map((direction) => [
    <ToggleGroup.Item key={direction.key} value={direction.key} className={s.direction} aria-keyshortcuts={shortcut(direction.key)}>
      <Label direction={direction} />
    </ToggleGroup.Item>,
    // Today stands apart from the directions it is compared with.
    direction.key === TODAY && <span key="rule" className={s.rule} aria-hidden="true" />,
  ])
  return (
    <footer className={s.bar} aria-label="Directions and states">
      <span className={s.title} title={title}>
        {title}
      </span>
      {shown.side === null ? (
        <ToggleGroup.Root
          type="single"
          aria-label="Direction"
          className={s.directions}
          value={shown.direction}
          onValueChange={(direction) => direction !== '' && onShow({ ...shown, direction })}
        >
          {items}
        </ToggleGroup.Root>
      ) : (
        <ToggleGroup.Root
          type="multiple"
          aria-label="Directions side by side"
          className={s.directions}
          value={[...shown.side]}
          onValueChange={(side) => side.length > 0 && onShow({ ...shown, side: offered.directions.filter((key) => side.includes(key)) })}
        >
          {items}
        </ToggleGroup.Root>
      )}
      {states.length > 0 && (
        <div className={s.states}>
          <span className={s.label} aria-hidden="true">
            State
          </span>
          <Segmented
            label="State"
            options={states.map((state) => ({ value: state.key, label: state.name }))}
            value={shown.state}
            onChange={(state) => onShow({ ...shown, state })}
          />
        </div>
      )}
      <div className={s.end}>
        {directions.length > 1 && (
          <div className={s.sideBySide}>
            <span id={sideLabel}>Side by side</span>
            <Switch
              checked={shown.side !== null}
              onChange={(on) => onShow({ ...shown, side: on ? [...offered.directions] : null })}
              labelledBy={sideLabel}
            />
          </div>
        )}
        <Popover
          label="Keys"
          placement="above"
          align="end"
          width={300}
          trigger={
            <Button variant="quiet" size="small">
              Keys
            </Button>
          }
        >
          <Keys today={directions.some((direction) => direction.key === TODAY)} states={states.length > 1} />
        </Popover>
      </div>
    </footer>
  )
}

function Keys({ today, states }: { today: boolean; states: boolean }) {
  return (
    <dl className={s.keys}>
      <dt>
        <Kbd>1</Kbd>–<Kbd>9</Kbd>
      </dt>
      <dd>Show direction A, B, C…; side by side, take one out or put it back</dd>
      {today && (
        <>
          <dt>
            <Kbd>0</Kbd>
          </dt>
          <dd>Show Today</dd>
        </>
      )}
      <dt>
        <Kbd>←</Kbd> <Kbd>→</Kbd>
      </dt>
      <dd>Previous or next direction</dd>
      {states && (
        <>
          <dt>
            <Kbd>[</Kbd> <Kbd>]</Kbd>
          </dt>
          <dd>Previous or next state</dd>
        </>
      )}
      <dt>
        <Kbd>S</Kbd>
      </dt>
      <dd>Side by side, on or off</dd>
      <dt>
        <Kbd>H</Kbd>
      </dt>
      <dd>Hide or show this bar</dd>
    </dl>
  )
}

/** Side by side, a direction designed at a width is scaled down to fit its column, so it lays out as it would alone. */
function Fit({ width, children }: { width: number | undefined; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const column = ref.current
    if (width === undefined || column === null) return
    const observer = new ResizeObserver(([entry]) => setZoom(Math.min(1, (entry?.contentRect.width ?? width) / width)))
    observer.observe(column)
    return () => observer.disconnect()
  }, [width])
  return (
    <div ref={ref} className={s.paneBody}>
      {width === undefined ? children : <div style={{ width, zoom }}>{children}</div>}
    </div>
  )
}

function Problems({ problems }: { problems: readonly string[] }) {
  return (
    <div className={s.problems} role="alert">
      <h1>This prototype can’t be shown yet</h1>
      <ul>
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  )
}

interface GuardProps {
  name: string
  /** What, once it changes, is worth drawing again after a failure: the state, a new version of the prototype. */
  reset: readonly unknown[]
  children: ReactNode
}

/** A direction that fails to draw says so in its place, and the bar and the other directions go on working. */
class Guard extends Component<GuardProps, { error: Error | null; reset: readonly unknown[] }> {
  override state = { error: null as Error | null, reset: this.props.reset }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: GuardProps, state: { reset: readonly unknown[] }) {
    const changed = props.reset.length !== state.reset.length || props.reset.some((value, at) => value !== state.reset[at])
    return changed ? { error: null, reset: props.reset } : null
  }

  override render() {
    if (this.state.error === null) return this.props.children
    return (
      <div className={s.failed} role="alert">
        <strong>{this.props.name} failed to draw.</strong>
        <code>{this.state.error.message}</code>
      </div>
    )
  }
}
